// ISS-17: strict-improvement 唯一判定（l1-config 内 6 个门共用）。
//
// 背景：ISS-01 修了 l3-engine 的严格门（Δ=0 必须 reject），但 l1-config 中
// 6 个 `*StrictImprovementGate` 各自实现、语义分叉——3 处沿用「不退化为过」
// （Δ=0 放行），3 处要求「至少一项严格改善」。同一规则在不同 substrate 上
// 结论相反。
//
// 本模块把该规则收敛为一个纯函数，6 个门只负责把各自 fitness 形状映射为
// 「候选 - 基线，且越大越好」的 deltas。

/**
 * 统一严格改进判定（ISS-01/ISS-17 语义）。
 *
 * @param deltas 各指标「候选 - 基线」，**已换算为越大越好方向**。
 * @param tau    退化容差。退化达到或超过 tau → reject。
 * @returns 无任一指标退化超 tau 且至少一项严格改善（delta > 0）时 true。
 *
 * 关键性质：**Δ=0 一律 reject**（无改进不得入选），与 ISS-01 一致。
 */
export function strictImprovement(deltas: readonly number[], tau: number): boolean {
  // 任一指标退化达到/超过 tau → reject。
  // tau=0 时退化为 delta < 0（0 视为「未改善」而非退化，由下方严格改善判定拒绝）。
  const degraded = deltas.some((d) => (tau > 0 ? d <= -tau : d < 0));
  if (degraded) return false;
  // 至少一项严格改善（排除 Δ=0）。
  return deltas.some((d) => d > 0);
}
