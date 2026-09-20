// CE-T07: fresh-evidence 终审门 hook — select 前 abort 若无 exit-code 证据。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T07 + ERRATA-w2plus CE-25（FreshEvidence.verifications
// 复用 CE-T02 VerifierRun 导出契约）。
//
// 铁律：变体 select 前必须执行 ≥1 条机械命令、exit code=裁决、禁 prose reasoning 当成功
// （bigpowers verify-work terminal-verdict gate + SpecPow execution-verification-before-completion
// 同源印证，PRD §5.6 fresh-evidence 终审门）。嵌入 L3 select 步（L3-T04 strict-improvement 前置）。
//
// 行为规范：
// - variant 有 ≥1 条 verifications 且每条有 exitCode → 放行（不 throw）。
// - verifications=[] 或 hasExitCodeEvidence=false → throw AbortSelectError（select abort）。
// - evidence 仅含 prose "应该过了" 无 exitCode → throw AbortSelectError（错误路径）。

import type { VerifierRun } from "./verifier.js";

/**
 * select 前的 fresh-evidence 终审门输入。
 *
 * - `variantSha`：待 select 的候选变体 commit sha。
 * - `verifications`：≥1 条 CE-T02 `VerifierRun`，每条须含 `exitCode`（机械裁决）。
 * - `hasExitCodeEvidence`：不变量，标记本证据集合是否含 exit-code 裁决。
 *
 * `VerifierRun` 复用 CE-T02 导出契约（ERRATA-w2plus CE-25：CE-T05 calibrateAgainstL0
 * 入参 l0Verdicts、CE-T07 FreshEvidence.verifications 均复用本导出）。
 */
export interface FreshEvidence {
  variantSha: string;
  verifications: VerifierRun[]; // ≥1 条，每条有 exitCode
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
 * fresh-evidence 终审门：select 前校验 verifications 含 ≥1 条机械 exit-code 裁决。
 *
 * 判定规则（逐条校验，任一不满足即 throw `AbortSelectError`）：
 * 1. `verifications.length >= 1`——空集 = 无机械证据 = abort（边界）。
 * 2. `hasExitCodeEvidence === true`——调用方不变量为假 = abort（边界）。
 * 3. 每条 verification 须有数值型 `exitCode`——prose "应该过了" 无 exitCode = abort
 *    （错误路径；运行时缺失 exitCode 由 `typeof === "number"` 防御）。
 *
 * 放行（不 throw）当且仅当上述三条全满足。
 */
export function assertFreshEvidence(e: FreshEvidence): void {
  // 边界：verifications 为空集 → 无机械证据 → abort。
  if (!Array.isArray(e.verifications) || e.verifications.length === 0) {
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
  for (const v of e.verifications) {
    if (v === null || typeof v !== "object" || typeof (v as { exitCode?: unknown }).exitCode !== "number") {
      throw new AbortSelectError(
        `fresh-evidence gate: variant "${e.variantSha}" has a verification ` +
          `(taskId="${(v as { taskId?: unknown })?.taskId ?? "?"}") without numeric exitCode; ` +
          `select aborted — prose "应该过了" is not mechanical evidence`,
      );
    }
  }
}
