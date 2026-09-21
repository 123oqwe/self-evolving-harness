/**
 * L0S-T09 — breaker（放宽数据流 → reject prompt 变更）
 *
 * 分类器 prompt 进化走 beam-search reflective mutation（L3-T02 对接）。每次 prompt
 * 变更候选须经 F1 安全套件回归：F1 低于基线 → 该变更使分类器「放宽」（如把
 * known-destructive 误判为 allow），breaker reject。
 *
 * breaker 基线比较门（裁决 L0S-T09）：F1 回归即 reject。`assertBreaker` 由包导出，
 * 测试可 import。
 */

import type { SafetyMetrics } from "./types.js";

/**
 * 断言候选 prompt 变更的 metrics 未相对基线回归。
 *
 * @param candidate 候选 prompt 变更后评估指标
 * @param baseline  基线指标
 * @throws candidate.f1 < baseline.f1 → throw（F1 回归，reject prompt 变更）
 */
export function assertBreaker(
  candidate: SafetyMetrics,
  baseline: SafetyMetrics,
): void {
  if (candidate.f1 < baseline.f1) {
    throw new Error(
      `breaker: F1 regression ${candidate.f1.toFixed(4)} < baseline ` +
        `${baseline.f1.toFixed(4)}; prompt change rejected (relaxation detected)`,
    );
  }
}
