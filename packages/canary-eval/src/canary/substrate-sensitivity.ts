// ISS-02 步骤③④: 敏感性守卫 + 阴性对照(纯函数)。
//
// ③ 敏感性守卫: baseline 与所有候选的逐任务结果向量完全相同 → 判 insensitive，
//   拒绝 accept 并写入报告。杜绝「候选与 baseline 产出相同 VerifierRun 却仍被
//   accept」的因果断裂假信号(ISS-01/ISS-02 lift=0 false positive)。
// ④ 阴性对照: 每轮自动构造一个故意破坏的候选(删 Blocked 段)，其得分必须低于
//   baseline，否则判任务集无效并 abort。证明代理任务集对基质退化有区分力。
//
// 均为纯函数(确定性、无 I/O、无随机)，可独立单测。

import type { VerifierRun } from "../verifier.js";

/** 逐任务结果向量(敏感性比对的最小粒度)。 */
export interface TaskResultVector {
  taskId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 从 VerifierRun[] 提取逐任务结果向量(只比机械裁决与输出，不比 runId)。 */
export function toResultVector(runs: VerifierRun[]): TaskResultVector[] {
  return runs.map((r) => ({
    taskId: r.taskId,
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
  }));
}

/** 两个结果向量逐任务全等(长度、taskId、exitCode、stdout、stderr 均相同)。 */
export function resultVectorsIdentical(
  a: TaskResultVector[],
  b: TaskResultVector[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.taskId !== y.taskId ||
      x.exitCode !== y.exitCode ||
      x.stdout !== y.stdout ||
      x.stderr !== y.stderr
    ) {
      return false;
    }
  }
  return true;
}

/** 敏感性裁决。 */
export interface InsensitivityVerdict {
  insensitive: boolean;
  reason: string | null;
  identicalCandidates: number;
  totalCandidates: number;
}

/**
 * ③ 敏感性守卫(纯函数): 若所有候选的结果向量都与 baseline 全等 → 判 insensitive。
 *
 * 语义: 被进化基质(compaction prompt)未被代理任务真实消费时，候选与 baseline
 * 的 VerifierRun 完全相同，此时任何 accept 都是无因果的假信号 → 必须拒绝。
 */
export function detectSubstrateInsensitivity(
  baseline: VerifierRun[],
  candidates: Array<{ id: string; runs: VerifierRun[] }>,
): InsensitivityVerdict {
  const baselineVec = toResultVector(baseline);
  let identical = 0;
  for (const c of candidates) {
    if (resultVectorsIdentical(baselineVec, toResultVector(c.runs))) {
      identical++;
    }
  }
  const insensitive = candidates.length > 0 && identical === candidates.length;
  return {
    insensitive,
    reason: insensitive
      ? `substrate-insensitive: all ${candidates.length} candidate(s) produce result vectors identical to baseline — no causal signal, reject accept`
      : null,
    identicalCandidates: identical,
    totalCandidates: candidates.length,
  };
}

/** 敏感性守卫失败错误(select 前 abort 用)。 */
export class SubstrateInsensitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstrateInsensitiveError";
  }
}

/** ③ 断言形式: 判 insensitive 即 throw(嵌入 select 步，拒绝 accept)。 */
export function assertSubstrateSensitive(
  baseline: VerifierRun[],
  candidates: Array<{ id: string; runs: VerifierRun[] }>,
): void {
  const v = detectSubstrateInsensitivity(baseline, candidates);
  if (v.insensitive) {
    throw new SubstrateInsensitiveError(v.reason ?? "substrate-insensitive");
  }
}

// ---------------------------------------------------------------------------
// ④ 阴性对照(纯函数)
// ---------------------------------------------------------------------------

/** 故意破坏 compaction prompt(默认删 Blocked 段，模拟 recall 退化)。 */
export function breakCompactionPrompt(
  content: string,
  mode: "remove-blocked" | "remove-safety" = "remove-blocked",
): string {
  if (mode === "remove-safety") {
    return content.replace(/<safety>[\s\S]*?<\/safety>/g, "");
  }
  // remove-blocked: 删 `### Blocked` 段(标题 + 其 body，直到下一个 `## ` 顶层段)。
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "### Blocked") {
      skipping = true;
      continue; // 丢弃标题行
    }
    if (skipping && line.startsWith("## ")) {
      skipping = false; // 下一顶层段恢复保留
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

/** 从 VerifierRun[] 计算通过率(exitCode===0 占比，= Fitness.resolve_rate)。 */
export function resolveRateFromRuns(runs: VerifierRun[]): number {
  if (runs.length === 0) return 0;
  const passed = runs.filter((r) => r.exitCode === 0).length;
  return passed / runs.length;
}

/** 阴性对照裁决。 */
export interface NegativeControlVerdict {
  valid: boolean;
  baselineScore: number;
  brokenScore: number;
  reason: string | null;
}

/**
 * ④ 阴性对照(纯函数): 破坏候选得分必须严格低于 baseline，否则任务集无区分力。
 */
export function checkNegativeControl(
  baseline: VerifierRun[] | number,
  broken: VerifierRun[] | number,
): NegativeControlVerdict {
  const baselineScore =
    typeof baseline === "number" ? baseline : resolveRateFromRuns(baseline);
  const brokenScore =
    typeof broken === "number" ? broken : resolveRateFromRuns(broken);
  const valid = brokenScore < baselineScore;
  return {
    valid,
    baselineScore,
    brokenScore,
    reason: valid
      ? null
      : `negative control failed: broken candidate scored ${brokenScore} (must be < baseline ${baselineScore}) — task set cannot discriminate substrate regressions; abort`,
  };
}

/** 阴性对照失败错误(任务集无效 → abort 用)。 */
export class NegativeControlInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NegativeControlInvalidError";
  }
}

/** ④ 断言形式: 阴性对照不满足即 throw(每轮评分前 abort)。 */
export function assertNegativeControl(
  baseline: VerifierRun[] | number,
  broken: VerifierRun[] | number,
): void {
  const v = checkNegativeControl(baseline, broken);
  if (!v.valid) {
    throw new NegativeControlInvalidError(v.reason ?? "negative control invalid");
  }
}
