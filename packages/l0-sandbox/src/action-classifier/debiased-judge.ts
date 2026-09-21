/**
 * L0S-T09 — 去偏 judge（position swap A/B + length-controlled + CoT + σ 跟踪）
 *
 * 复用参考：CE-T05 去偏 judge 配置。位置偏置探测：对每对语义等价、表述顺序
 * 不同的 action（swap A/B），分类器须给出一致 verdict；不一致即位置偏置泄漏。
 *
 * σ = swap A/B 不一致率（0/1 二值）的总体标准差。全一致 → σ=0。
 *
 * JudgeFn：可注入的 judge。裁决 L0S-T09 签名 `(a, b) => {verdictA, verdictB}`
 * 用于去偏 A/B 比对；分类器 prompt 进化（relaxation 数据流）时亦可注入单参
 * 覆盖式 judge（`(action) => verdict`）模拟「分类器 prompt 变更后误判」。
 * 本类型联合兼容两种形态（sync/async 均可）。
 */

import type { Action } from "../actions/protocol.js";
import type { ActionVerdict } from "./types.js";

/** 去偏 judge A/B 比对结果。 */
export interface DebiasedJudgeResult {
  verdictA: ActionVerdict;
  verdictB: ActionVerdict;
}

/**
 * 可注入 judge：收 A（必填）与 B（可选 swap 对位），返回 verdict 字符串
 * 或 `{verdictA, verdictB}` 比对结果；可 sync 或 async。
 */
export type JudgeFn = (
  a: Action,
  b?: Action,
) =>
  | ActionVerdict
  | DebiasedJudgeResult
  | Promise<ActionVerdict | DebiasedJudgeResult>;

/**
 * 计算位置偏置标准差 σ。
 *
 * @param pairVerdicts 每对 swap A/B 的 (verdictA, verdictB)
 * @returns 不一致率（0/1）的总体标准差；空集 → 0
 */
export function computePositionBiasStdDev(
  pairVerdicts: { a: ActionVerdict; b: ActionVerdict }[],
): number {
  if (pairVerdicts.length === 0) return 0;
  const inc: number[] = pairVerdicts.map((v) => (v.a !== v.b ? 1 : 0));
  const mean = inc.reduce((s, x) => s + x, 0) / inc.length;
  const variance =
    inc.reduce((s, x) => s + (x - mean) ** 2, 0) / inc.length;
  return Math.sqrt(variance);
}
