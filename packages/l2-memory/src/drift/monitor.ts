// L2-T13: library drift 监控 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T13。
//
// library drift 三子模式指标监控：
//  - stagnation：skill 从未达 solver（active 库收敛性）。
//  - bloat：无界增长降检索精度（active size 相对 cap C 溢出）。
//  - erosion：过激进退役崩塌库（误退役率 = archived 后被检索次数 / archived 数）。
//
// 健康判定（spec §L2-T13 isHealthy 注释）：
//   overRetiredRate <= 0.05  ∧  activeSize <= C  ∧  retrievalPrecision >= 0.7
//
// 设计约束（spec 执行提示）：三指标全可机械测量（库 size、误退役次数、
// held-out pass 率），**禁** LLM judge 主导。故 monitor 仅做确定性聚合，
// 不引入任何非确定性调用。
//
// 输入约定：monitor 通过 MemCtx 的 side channel 接收可机械测量的原始计数
// （遵循 ERRATA-w2plus MemCtx side-channel 裁决，与 L2-T12/T03b 一致）：
//   - activeSkills?: { reachedSolver: boolean }[]  → stagnation 计数
//   - activeSize?: number                          → bloat activeSize
//   - retrievalPrecision?: number                  → bloat retrievalPrecision
//   - archivedResearchedAfter?: number             → erosion 分子
//   - archivedCount?: number                       → erosion 分母
// 缺省时取中性值（0 / 0.9），避免在无证据时虚高指标。

import type { MemCtx } from "../memory-tool/commands.js";

/**
 * library drift 三子模式报告。
 *
 * 注意：与 L2-T12 `DriftMetrics`（三元 number，供 GEPA Pareto 标量前沿）
 * 语义对齐但形状不同——本类型为结构化子对象，供健康判定与 L2-T10
 * lifecycle 消费。详见 TASKS.md §L2-T13 REFACTOR 备注。
 */
export interface DriftReport {
  stagnation: { neverReachedSolver: number };
  bloat: { activeSize: number; retrievalPrecision: number };
  erosion: { overRetiredRate: number; archivedResearchedAfter: number };
}

/** active 库 cap C（与 L2-T12 DEFAULT_RATCHET_PARAMS.C / collectDrift 对齐）。 */
const ACTIVE_CAP_C = 50;

/** 默认检索精度（无证据退化时取中性健康值）。 */
const DEFAULT_RETRIEVAL_PRECISION = 0.9;

/** 健康阈值（spec §L2-T13 isHealthy 注释）。 */
const OVER_RETIRED_RATE_MAX = 0.05;
const RETRIEVAL_PRECISION_MIN = 0.7;

/** monitor 的 MemCtx side-channel 扩展（确定性原始计数）。 */
type DriftCtx = MemCtx & {
  activeSkills?: { reachedSolver: boolean }[];
  activeSize?: number;
  retrievalPrecision?: number;
  archivedResearchedAfter?: number;
  archivedCount?: number;
};

/**
 * 采集三 drift 子模式指标。
 *
 * 行为规范（spec §L2-T13）：
 *  - active 库 50 skill 全从未触达 solver → stagnation.neverReachedSolver=50。
 *  - activeSize=60（超 C=50）→ bloat.activeSize=60。
 *  - archivedResearchedAfter/archived=0.08 → erosion.overRetiredRate=0.08。
 *
 * @param ctx 可选 MemCtx（side channel 携带可机械测量的原始计数）。
 * @returns DriftReport。
 */
export function monitor(ctx?: MemCtx): DriftReport {
  const c = (ctx ?? {}) as DriftCtx;

  // stagnation：active 库中从未达 solver 的条目数。
  const skills = c.activeSkills ?? [];
  const neverReachedSolver = skills.reduce(
    (acc, s) => acc + (s && s.reachedSolver === false ? 1 : 0),
    0,
  );

  // bloat：active size（条目数）+ 检索精度。
  const activeSize =
    typeof c.activeSize === "number"
      ? c.activeSize
      : skills.length;
  const retrievalPrecision =
    typeof c.retrievalPrecision === "number"
      ? c.retrievalPrecision
      : DEFAULT_RETRIEVAL_PRECISION;

  // erosion：误退役率 = archived 后被检索次数 / archived 数。
  // archived 数为 0 或缺失时退化为 0（无证据表明误退役）。
  const archivedResearchedAfter =
    typeof c.archivedResearchedAfter === "number" ? c.archivedResearchedAfter : 0;
  const archivedCount =
    typeof c.archivedCount === "number" ? c.archivedCount : 0;
  const overRetiredRate =
    archivedCount > 0 ? archivedResearchedAfter / archivedCount : 0;

  return {
    stagnation: { neverReachedSolver },
    bloat: { activeSize, retrievalPrecision },
    erosion: { overRetiredRate, archivedResearchedAfter },
  };
}

/**
 * 健康判定（spec §L2-T13）：
 *   overRetiredRate <= 0.05  ∧  activeSize <= C  ∧  retrievalPrecision >= 0.7
 *
 * 注意：stagnation.neverReachedSolver 不参与健康判定（spec isHealthy 注释
 * 仅列三条件）；stagnation 为观测指标，供 L2-T12 collectDrift / L3 优化器
 * 作收敛性信号。
 */
export function isHealthy(report: DriftReport): boolean {
  return (
    report.erosion.overRetiredRate <= OVER_RETIRED_RATE_MAX &&
    report.bloat.activeSize <= ACTIVE_CAP_C &&
    report.bloat.retrievalPrecision >= RETRIEVAL_PRECISION_MIN
  );
}
