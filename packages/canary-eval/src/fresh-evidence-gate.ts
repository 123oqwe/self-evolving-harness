// CE-T07: fresh-evidence 终审门 hook — select 前 abort 若无通过裁决的机械 exit-code 证据。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T07 + ERRATA-w2plus CE-25（FreshEvidence.verifications
// 复用 CE-T02 VerifierRun 导出契约）+ PRD §5.6 terminal-verdict 终审门语义。
//
// 铁律：变体 select 前必须执行 ≥1 条机械命令、exit code=0（pass）裁决背书、禁 prose reasoning
// 当成功（bigpowers verify-work terminal-verdict gate + SpecPow execution-verification-before-completion
// 同源印证，PRD §5.6 fresh-evidence 终审门）。嵌入 L3 select 步（L3-T04 strict-improvement 前置）。
//
// 行为规范：
// - variant 有 ≥1 条 verifications 且每条 exitCode===0（pass 裁决）→ 放行（不 throw）。
// - verifications=[] 或 hasExitCodeEvidence=false → throw AbortSelectError（select abort）。
// - evidence 仅含 prose "应该过了" 无 exitCode → throw AbortSelectError（错误路径）。
// - 任一条 exitCode!==0（FAIL 裁决）→ throw AbortSelectError（fail-closed reject）——
//   阻断「Fitness.resolve_rate=1 但机械裁决 FAIL」的伪造信号 fail-open 路径。
//   生产 wiring 下 FitnessBridge.fromTelemetry 的 resolve_rate←gen_ai_evaluation.pass 与
//   VerifierRun.exitCode 是两条独立通道无绑定；被进化的 prompt 可经 prompt injection 使 LLM
//   judge 通道报 pass=true 而机械 canary FAIL。本门强制机械裁决须 pass（exitCode===0），
//   使 FAIL 裁决 fail-closed reject，阻断裸 Fitness 即 select 的伪造信号晋升路径。

import type { VerifierRun } from "./verifier.js";
import { filterForgedEperm } from "./eperm-cross-check.js";

/**
 * select 前的 fresh-evidence 终审门输入。
 *
 * - `variantSha`：待 select 的候选变体 commit sha。
 * - `verifications`：≥1 条 CE-T02 `VerifierRun`，每条须含 `exitCode===0`（pass 机械裁决）。
 * - `hasExitCodeEvidence`：不变量，标记本证据集合是否含 exit-code 裁决。
 *
 * `VerifierRun` 复用 CE-T02 导出契约（ERRATA-w2plus CE-25：CE-T05 calibrateAgainstL0
 * 入参 l0Verdicts、CE-T07 FreshEvidence.verifications 均复用本导出）。
 */
export interface FreshEvidence {
  variantSha: string;
  verifications: VerifierRun[]; // ≥1 条，每条 exitCode===0（pass 裁决）
  hasExitCodeEvidence: boolean; // 不变量
}

/**
 * select 前无 exit-code 机械证据时抛出，由 L3 archive 路径捕获（不入 archive）。
 *
 * 嵌入 L3-T04 strict-improvement 步：L3 调 `assertFreshEvidence(variantSha)` →
 * 无 exit-code 证据即 throw `AbortSelectError`，select abort。
 */
export class AbortSelectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortSelectError";
  }
}

/**
 * fresh-evidence 终审门：select 前校验 verifications 含 ≥1 条机械 exit-code=0（pass）裁决。
 *
 * 判定规则（逐条校验，任一不满足即 throw `AbortSelectError`）：
 * 1. `verifications.length >= 1`——空集 = 无机械证据 = abort（边界）。
 * 2. `hasExitCodeEvidence === true`——调用方不变量为假 = abort（边界）。
 * 3. 每条 verification 须有数值型 `exitCode`——prose "应该过了" 无 exitCode = abort
 *    （错误路径；运行时缺失 exitCode 由 `typeof === "number"` 防御）。
 * 4. 每条 verification 须 `exitCode === 0`（pass 裁决）——FAIL 裁决（exitCode!==0）= abort
 *    （fail-closed）。这使 Fitness 与机械裁决两条独立通道交叉绑定：即便 Fitness.resolve_rate=1
 *    （经 prompt injection 的 LLM judge 通道报 pass=true），机械 canary FAIL 仍 reject，
 *    阻断「裸 Fitness 即 select」的伪造信号 fail-open 路径（PRD §5.6 terminal-verdict）。
 *
 * 放行（不 throw）当且仅当上述四条全满足。
 */
export function assertFreshEvidence(e: FreshEvidence): void {
  // SEC-T01 (L0S-R2 落实)：入口先调 filterForgedEperm 丢弃伪造面证据再判定。
  // 单一职责接线点——别在多处重复过滤。伪造面 = exitCode=0 但 epermHits 非空
  // （stderr 可伪造 EPERM 行，exitCode 不可；两者须自洽）。
  const { kept: verifications, warnings } = filterForgedEperm(
    Array.isArray(e.verifications) ? e.verifications : [],
  );
  // 告警不阻断判定，仅记录到 stderr 侧信道（console.warn）便于审计。
  for (const w of warnings) {
    // eslint-disable-next-line no-console
    console.warn(w);
  }

  // 边界：verifications 为空集 → 无机械证据 → abort。
  if (verifications.length === 0) {
    throw new AbortSelectError(
      `fresh-evidence gate: variant "${e.variantSha}" has no verifications ` +
        `(verifications.length=0); select aborted — exit-code evidence required`,
    );
  }

  // 边界：hasExitCodeEvidence 不变量为假 → abort。
  if (e.hasExitCodeEvidence !== true) {
    throw new AbortSelectError(
      `fresh-evidence gate: variant "${e.variantSha}" hasExitCodeEvidence=false; ` +
        `select aborted — exit-code evidence required (prose reasoning is not success)`,
    );
  }

  // 错误路径：某条 verification 缺 exitCode（prose "应该过了"）→ abort。
  // VerifierRun.exitCode 类型上为 number，但运行时可能被调用方以 `as unknown` 注入
  // 缺失值（CE-T07 测试 prose 路径），故用 typeof 防御。
  for (const v of verifications) {
    if (
      v === null ||
      typeof v !== "object" ||
      typeof (v as { exitCode?: unknown }).exitCode !== "number"
    ) {
      throw new AbortSelectError(
        `fresh-evidence gate: variant "${e.variantSha}" has a verification ` +
          `(taskId="${(v as { taskId?: unknown })?.taskId ?? "?"}") without numeric exitCode; ` +
          `select aborted — prose "应该过了" is not mechanical evidence`,
      );
    }
  }

  // fail-closed 路径：任一条 exitCode!==0（FAIL 裁决）→ abort。
  // PRD §5.6 terminal-verdict 终审门语义：背书 select 的机械裁决须为 pass（exitCode===0）。
  // 「有裁决」≠「裁决通过」——FAIL 裁决不得背书 Fitness.resolve_rate=1 的 select。
  // 生产 wiring 下 Fitness（telemetry→gen_ai_evaluation.pass）与 VerifierRun.exitCode（机械 canary）
  // 是两条独立通道；本交叉校验阻断「LLM judge pass=true 但机械 canary FAIL」的 prompt-injection
  // 伪造信号 fail-open 路径。
  for (const v of verifications) {
    if ((v as { exitCode: number }).exitCode !== 0) {
      throw new AbortSelectError(
        `fresh-evidence gate: variant "${e.variantSha}" has a failing verification ` +
          `(taskId="${v.taskId}", exitCode=${(v as { exitCode: number }).exitCode}); ` +
          `select aborted — mechanical verdict must be pass (exitCode===0) to endorse Fitness ` +
          `(FAIL verdict must fail-closed reject, not endorse resolve_rate=1)`,
      );
    }
  }
}
