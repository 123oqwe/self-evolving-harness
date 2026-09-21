// CE-T12 落地：benchmark 投毒检测 — 变体在 clean canary 反降分 → 疑似投毒隔离。
//
// 背景（PRD §10 R3 / §11.1 canary 子集）：Thompson trusting-trust 攻击变体
// 在污染 canary 上"涨分"但在 clean canary 上反降分 → 疑似投毒，隔离不上线
// （never-auto-delete：投毒变体入 `rejected/quarantine/` 供诊断）。
//
// ERRATA-w2plus CE-24：`detectPoison` 三参 `(variant, cleanCanary, opts?)`；
//   opts.cleanCanaryScore / opts.baselineCleanScore 注入（须在 clean canary 上
//   跑变体得到）；`suspectedPoison = cleanCanaryScore < baselineCleanScore - τ`；
//   τ 阈值默认用 CE-T08 σ=5.4pp（0.054）作下界，不硬编码更大值。
//
// `Variant` 类型复用 CE-T05 首处定义（judge-debias.ts）；`CanaryManifest` 复用
// CE-T01a canary/types.ts（不重复定义）。

import type { Variant } from "./judge-debias.js";
import type { CanaryManifest } from "./canary/types.js";

/**
 * CE-T08 σ 阈值（5.4pp = 0.054）下界——LiveMCPBench 实证噪声地板，
 * 作 τ（投毒降分判定阈值）的默认下界，避免噪声误隔离。
 * （与 judge-debias `sigmaThreshold` 默认 5.4pp、CE-T09 DISCRIMINATION_THRESHOLD
 *   5pp 噪声带同源。）
 */
export const POISON_TAU = 0.054;

/** 单个 variant 的投毒检测结果。 */
export interface PoisonCheck {
  /** 被检 variant commit sha */
  variantSha: string;
  /** 变体在 clean canary 上的得分 */
  cleanCanaryScore: number;
  /** clean canary baseline 得分 */
  baselineCleanScore: number;
  /** clean 反降分（疑似投毒） */
  suspectedPoison: boolean;
  /** 隔离不上线 */
  isolated: boolean;
}

/**
 * 投毒检测选项。
 *
 * - `cleanCanaryScore`：变体在 clean canary 上的得分（须调用方在 clean canary
 *   上跑变体得到后注入）。
 * - `baselineCleanScore`：clean canary baseline 得分。
 * - `tau`：投毒降分判定阈值，默认 POISON_TAU=0.054（CE-T08 σ 下界），
 *   调用方不得硬编码更大值以放宽隔离门。
 */
export interface PoisonDetectOptions {
  cleanCanaryScore?: number;
  baselineCleanScore?: number;
  tau?: number;
}

/**
 * 检测变体是否疑似投毒（在 clean canary 上反降分）。
 *
 * 铁律：`suspectedPoison = cleanCanaryScore < baselineCleanScore - τ`；
 * 隔离 ≠ 删除（never-auto-delete）——`isolated=suspectedPoison` 仅标记不上线，
 * 投毒变体入 `release_policy.yaml` 的 quarantine 区供诊断。
 *
 * 错误路径：clean canary 不可用（`null`/`undefined`）→ throw，不放行
 * （宁可误隔离）。
 *
 * @param variant 被检变体（复用 CE-T05 Variant 形状）
 * @param cleanCanary clean canary manifest（不可用 → throw）
 * @param opts 注入 cleanCanaryScore / baselineCleanScore / tau
 */
export async function detectPoison(
  variant: Variant,
  cleanCanary: CanaryManifest | null | undefined,
  opts?: PoisonDetectOptions,
): Promise<PoisonCheck> {
  // 错误路径：clean canary 不可用 → throw + 不放行（宁可误隔离）。
  if (cleanCanary == null) {
    throw new Error("clean canary unavailable: cannot assess poison (fail-closed)");
  }

  const cleanCanaryScore = opts?.cleanCanaryScore ?? 0;
  const baselineCleanScore = opts?.baselineCleanScore ?? 0;
  // τ 默认 CE-T08 σ=5.4pp 下界；不硬编码更大值（ERRATA-w2plus CE-24）。
  const tau = opts?.tau ?? POISON_TAU;

  const suspectedPoison =
    cleanCanaryScore < baselineCleanScore - tau;

  return {
    variantSha: variant.sha,
    cleanCanaryScore,
    baselineCleanScore,
    suspectedPoison,
    isolated: suspectedPoison,
  };
}
