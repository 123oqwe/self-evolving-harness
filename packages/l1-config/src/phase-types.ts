// L1-T03 · phase substrate 共享类型
//
// `CacheHitSignal` 由 spec §L1-T03 接口签名定义，供 PhaseSubstrate.collectCacheHit
// 消费。独立模块便于 T05b（select-retain）复用同形状。

/**
 * cache-hit 信号：变异后稳态窗口内的 cache 命中度。
 * - `substrateSha`：基质内容 sha256（标识本次变异版本）。
 * - `isWarmUp`：变异后首个 session = true，不计稳态 Pareto（PRD §6.8 warm-up）。
 * - `cacheReadTokens`：本 session prompt 前缀命中 cache 的 token 数。
 * - `inputTokens`：本 session 输入总 token 数（cache 命中率 = cacheRead/input）。
 */
export interface CacheHitSignal {
  readonly substrateSha: string;
  readonly isWarmUp: boolean;
  readonly cacheReadTokens: number;
  readonly inputTokens: number;
}
