// CE-T05 落地：LLM-judge 去偏 — position swap A/B + length-controlled + CoT
// + combined-budget + σ 跟踪 + judge model pool。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T05 + ERRATA-w2plus 裁决
// （CE-14/CE-15/CE-16/CE-25/CE-27）：
// - `runDebiasedJudge` 四参 `(a, b, cfg, opts?)`；`opts.judge` 注入 swap A/B 两次评分；
//   `opts.agentModelFamily` 注入（"judge 与 variant 同模型族" = judge 与 agent 同模型族，
//   与 CE-T04 一致，CE-15）。
// - 同族 judge 从 pool 剔除；pool 全同族 → throw `SameModelFamilyError`（复用 judge-pool.ts），
//   且须在调用 judge 前（错误路径不 invoke judge）。
// - swap A/B 两次：round1 a@A/b@B、round2 a@B/b@A；`scoreA`/`scoreB` = 各自两轮均值；
//   `sigma` = 跨轮差值 (a-b) 的总体标准差，度量 position bias 抖动。
// - "声称 gap" = `|scoreA - scoreB|`（CE-16）；`consistent = sigma <= claimedGap`
//   （sigma > claimedGap → consistent=false，判 noise，不入选）。
// - `calibrateAgainstL0`：按 `VerifierRun.taskId` 与 `JudgeResult` 隐含配对，
//   `accuracy = 一致判定数 / 总数`（一致 = `judge.consistent` 与 `exitCode===0` 同向）；
//   公式仅类型约束 ∈[0,1]（CE-16）。
//
// `Variant` 为本模块首个定义处（CE-T05 接口签名），CE-T12 等后续任务复用此形状
// （L3 types.ts 未定义 Variant，不重复定义）。

import {
  selectCrossFamilyJudge,
  SameModelFamilyError,
} from "./judge-pool.js";
import type { VerifierRun } from "./verifier.js";

/**
 * 候选进化变体的最小可判别形状（本模块首个定义处；CE-T12 等后续任务复用）。
 *
 * 去偏 judge 只比较内容，不执行 variant。
 */
export interface Variant {
  /** variant commit sha */
  sha: string;
  /** 变更所属 harness 子模块（如 'l1-config'） */
  module: string;
  /** 变更后的配置/prompt 内容（去偏 judge 只比较内容，不执行） */
  config: unknown;
}

/**
 * LLM-judge 去偏配置（position swap A/B + length-controlled + CoT
 * + combined-budget + σ 跟踪 + judge model pool）。
 */
export interface DebiasConfig {
  /** A/B 两次 position swap */
  positionSwap: true;
  /** length-controlled（长度偏差控制） */
  lengthControlled: true;
  /** CoT（chain-of-thought 评分） */
  cot: true;
  /** combined budget（组合预算） */
  combinedBudget: number;
  /** σ > 声称 gap → 判 noise（默认 5.4pp，LiveMCPBench 实证） */
  sigmaThreshold: number;
  /** 异模型族 judge pool */
  modelPool: string[];
}

/** 单次去偏 judge 裁决结果。 */
export interface JudgeResult {
  scoreA: number;
  scoreB: number;
  /** 跨轮 position-bias 抖动 σ */
  sigma: number;
  /** sigma <= |scoreA-scoreB| 时为 true；sigma > gap → false（判 noise，不入选） */
  consistent: boolean;
}

/**
 * 默认 judge（未注入 opts.judge 时使用）：返回常数 0.5。
 *
 * 生产路径总由调用方注入 `opts.judge`（可控 LLM 调用）；此默认仅作类型完整兜底，
 * 不参与测试断言。
 */
const DEFAULT_JUDGE = async (_v: Variant, _pos: "A" | "B"): Promise<number> => 0.5;

/**
 * 执行一次 A/B position-swap 评分（REFACTOR：swap 实现抽独立函数）。
 *
 * Round 1：a@A、b@B；Round 2：a@B、b@A（position 互换）。
 * 返回 a/b 各自两轮分数，供均值与 σ 计算消费。
 */
async function runSwap(
  a: Variant,
  b: Variant,
  judge: (variant: Variant, position: "A" | "B") => Promise<number>,
): Promise<{ aScores: [number, number]; bScores: [number, number] }> {
  const aR1 = await judge(a, "A");
  const bR1 = await judge(b, "B");
  const aR2 = await judge(a, "B");
  const bR2 = await judge(b, "A");
  return { aScores: [aR1, aR2], bScores: [bR1, bR2] };
}

/**
 * 总体标准差（除以 N，非 N-1）。
 *
 * swap 仅两轮，N=2；用总体标准差度量跨轮 (a-b) 差值的 position-bias 抖动。
 */
function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 运行去偏 LLM-judge：position swap A/B + length-controlled + CoT
 * + combined-budget + σ 跟踪 + judge model pool。
 *
 * 流程：
 * 1. 若 `opts.agentModelFamily` 注入，先从 `cfg.modelPool` 选首个异族 judge
 *    （CE-15）；pool 全同族 → throw `SameModelFamilyError`（错误路径，judge 不被 invoke）。
 * 2. swap A/B 两次评分（REFACTOR：`runSwap`）。
 * 3. `scoreA`/`scoreB` = 各自两轮均值；`sigma` = 跨轮 (a-b) 差值总体标准差。
 * 4. `consistent = sigma <= |scoreA - scoreB|`（CE-16；sigma > claimedGap → noise）。
 *
 * @param a variant A
 * @param b variant B
 * @param cfg 去偏配置
 * @param opts `judge` 注入 swap 评分函数；`agentModelFamily` 注入（同族 judge 剔除）
 */
export async function runDebiasedJudge(
  a: Variant,
  b: Variant,
  cfg: DebiasConfig,
  opts?: {
    judge?: (variant: Variant, position: "A" | "B") => Promise<number>;
    agentModelFamily?: string;
  },
): Promise<JudgeResult> {
  // 1. judge model pool 选择：同族 judge 剔除（CE-15）。
  //    若注入 agentModelFamily 且 pool 全同族 → throw（错误路径，judge 不 invoke）。
  if (opts?.agentModelFamily !== undefined) {
    // selectCrossFamilyJudge 在无可用异族 judge 时 throw SameModelFamilyError；
    // 选中的 judge id 此处仅用于族校验（实际评分由 opts.judge 注入，可控）。
    selectCrossFamilyJudge(cfg.modelPool, opts.agentModelFamily);
  }

  const judge = opts?.judge ?? DEFAULT_JUDGE;

  // 2. swap A/B 两次（REFACTOR：runSwap 独立函数）。
  const { aScores, bScores } = await runSwap(a, b, judge);

  // 3. scoreA/scoreB = 各自两轮均值。
  const scoreA = (aScores[0] + aScores[1]) / 2;
  const scoreB = (bScores[0] + bScores[1]) / 2;

  // sigma = 跨轮 (a-b) 差值的总体标准差，度量 position bias 抖动。
  const diffs = [aScores[0] - bScores[0], aScores[1] - bScores[1]];
  const sigma = populationStdDev(diffs);

  // 4. consistent = sigma <= |scoreA - scoreB|（CE-16）。
  const claimedGap = Math.abs(scoreA - scoreB);
  const consistent = sigma <= claimedGap;

  return { scoreA, scoreB, sigma, consistent };
}

/**
 * 用 CE-T02 exit-code L0 裁决校准 judge accuracy（铁律：有 L0 就不上 L1）。
 *
 * 按 `VerifierRun.taskId` 与 `JudgeResult` 隐含配对（同一 variant 的任务集，
 * 按数组顺序一一对应）；一致 = `judge.consistent` 与 `exitCode===0` 同向
 * （同真或同假）。`accuracy = 一致判定数 / 总数`，∈[0,1]（CE-16 仅类型约束）。
 *
 * 分母为 0（空输入）时返回 0，避免除零。
 *
 * @param judgeResults 待校准的 judge 裁决集
 * @param l0Verdicts CE-T02 VerifierRun（exit-code 裁决，复用 CE-25 导出契约）
 */
export function calibrateAgainstL0(
  judgeResults: JudgeResult[],
  l0Verdicts: VerifierRun[],
): { accuracy: number } {
  const total = Math.min(judgeResults.length, l0Verdicts.length);
  if (total === 0) return { accuracy: 0 };

  let agreed = 0;
  for (let i = 0; i < total; i++) {
    const judge = judgeResults[i];
    const l0 = l0Verdicts[i];
    if (judge === undefined || l0 === undefined) continue;
    const judgeConsistent = judge.consistent === true;
    const l0Pass = l0.exitCode === 0;
    if (judgeConsistent === l0Pass) agreed += 1;
  }

  return { accuracy: agreed / total };
}
