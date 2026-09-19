// CE-T02: 确定性验证器 harness — verify: 命令 exit-code 裁决 / 单次连续 run / 禁跨 run 合并。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T02 + ERRATA-w2plus 裁决（CE-07/08/09/25）：
// - exit code = 裁决（0=pass，非 0=fail），禁止 prose "应该过了"。
// - 单次连续 run 捕获 stdout+stderr；runId 每次调用 uuid v4 重新生成。
// - 禁跨 run 合并证据：assertNoCrossRunMerge 检测 runId 复用（同一 runId ≥2 次 → throw
//   CrossRunMergeViolation）；stdout 哈希重复仅辅助证据，不单独触发。
// - sandbox 适配器接口与 L0S-T02 OssandboxBackend.runVerify(cmd, opts): VerifyResult 对齐，
//   VerifyResult 全字段形状从 @harness/l0-sandbox 导入，CE 不重写 sandbox 原语。
//
// 复用铁律：bigpowers verify-work terminal-verdict gate（≥1 shell 命令 exit code 即裁决，
// 单次连续 run，禁止跨 run 合并证据）+ SpecPow execution-verification-before-completion 同源。

import { randomUUID } from "node:crypto";
import type {
  RunVerifyOptions,
  VerifyResult,
} from "@harness/l0-sandbox";
import type { CanaryTask } from "./canary/types.js";
import { buildDefaultRunVerifyOptions } from "./sandbox-adapter.js";

/**
 * 单次 verify run 的裁决记录（Oracle L0 ground truth）。
 *
 * - `exitCode` 0=pass、非 0=fail = 裁决；禁止 prose "应该过了"。
 * - `stdout`/`stderr` 来自单次连续 run 捕获，禁止跨 run 合并。
 * - `runId` 唯一（uuid v4），每次 runVerify 调用重新生成。
 * - `contiguousRun` 恒为 true：不变量，标记本证据来自单次连续 run。
 */
export interface VerifierRun {
  taskId: string;
  command: string; // verify: shell 命令
  exitCode: number; // 0=pass, 非0=fail = 裁决
  stdout: string; // 单次连续 run 捕获
  stderr: string;
  runId: string; // 唯一，禁止跨 run 合并
  contiguousRun: true; // 不变量：本证据来自单次连续 run
  // ERRATA-w2plus §CE-T02 透传缺口：sandboxBypassed/epermHits 须从 VerifyResult 透传，
  // 使下游 fresh-evidence 门可识别“本条 L0 证据来自被旁路的 sandbox”。
  // 两个均为可选字段（runVerify 总会写入 epermHits；历史调用方构造的 VerifierRun 可缺省）。
  epermHits?: string[]; // sandbox EPERM 命中清单（透传自 VerifyResult.epermHits）
  sandboxBypassed?: boolean; // NoneBackend 旁路 sandbox 时透传，供下游标记绕过面风险
}

/**
 * CE 侧对 L0S-T02 OssandboxBackend 的最小消费契约。
 *
 * 与 L0S-T02 `OssandboxBackend.runVerify(cmd, opts): VerifyResult` 对齐；
 * `VerifyResult` 全字段形状（`exitCode`/`stdout`/`stderr`/`epermHits` + 可选
 * `sandboxBypassed?`）从 `@harness/l0-sandbox` 导入，CE 透传 `sandboxBypassed` 标记，
 * 不在 CE 内重写 sandbox 原语。
 */
export interface SandboxHandle {
  runVerify(
    cmd: string,
    opts: RunVerifyOptions,
  ): Promise<VerifyResult>;
}

/** 跨 run 合并证据违反（同一 runId 出现 ≥2 次）。 */
export class CrossRunMergeViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossRunMergeViolation";
  }
}

/**
 * 在 sandbox 内跑 task.verify 命令，单次连续 run 捕获 stdout+stderr，exit code = 裁决。
 *
 * 单次调用不感知"修复前/后"，修复态由调用方通过 sandbox 注入不同 VerifyResult 模拟
 * （fakeSandbox 顺序返回）。runId 每次调用 uuid v4 重新生成，两次调用 runId 不同。
 *
 * 错误路径（超时 / sandbox EPERM）：exitCode 非 0 且 stderr 含 timeout/EPERM 信息，
 * 不产生 prose "应该过了"——sandbox 返回的 VerifyResult 原样落 VerifierRun。
 */
export async function runVerify(
  task: CanaryTask,
  opts: { sandbox: SandboxHandle },
): Promise<VerifierRun> {
  const sandbox: SandboxHandle = opts.sandbox;
  const runOpts: RunVerifyOptions = buildDefaultRunVerifyOptions(task);
  // 单次连续 run：sandbox.runVerify 内部 spawn 一次，捕获完整 stdout+stderr+exitCode。
  const result: VerifyResult = await sandbox.runVerify(task.verify, runOpts);

  // 透传 sandbox 安全信号：NoneBackend 旁路 sandbox 时 sandboxBypassed=true，
  // 下游 fresh-evidence 门据此标记“本条证据来自被旁路的 sandbox”。
  // exactOptionalPropertyTypes：仅当 sandboxBypassed 显式定义时才落字段，避免写入 undefined。
  const run: VerifierRun = {
    taskId: task.id,
    command: task.verify,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    runId: randomUUID(), // uuid v4，每次调用重新生成
    contiguousRun: true, // 不变量：本证据来自单次连续 run
    epermHits: result.epermHits ?? [],
  };
  if (result.sandboxBypassed === true) {
    run.sandboxBypassed = true;
  }
  return run;
}

/**
 * 禁跨 run 合并证据门（verify-work / execution-verification-before-completion 同源铁律）。
 *
 * 检测语义（ERRATA-w2plus CE-08 裁决矛盾）= **runId 复用**：同一 runId 出现 ≥2 次 →
 * throw `CrossRunMergeViolation`。stdout 哈希重复不单独触发，仅作辅助证据。
 */
export function assertNoCrossRunMerge(runs: VerifierRun[]): void {
  const seen = new Map<string, VerifierRun>();
  for (const run of runs) {
    const prev = seen.get(run.runId);
    if (prev !== undefined) {
      // runId 复用 = 跨 run 合并证据。stdout 哈希重复仅辅助证据，写入 message。
      const stdoutConcatHint =
        prev.stdout !== run.stdout
          ? `; stdout differs across reused runId (possible concat: "${prev.stdout}" vs "${run.stdout}")`
          : "";
      throw new CrossRunMergeViolation(
        `cross-run merge detected: runId "${run.runId}" reused by task ` +
          `"${run.taskId}" (appears >=2 times)${stdoutConcatHint}`,
      );
    }
    seen.set(run.runId, run);
  }
}
