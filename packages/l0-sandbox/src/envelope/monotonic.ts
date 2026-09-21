/**
 * L0S-T13 — acceptance 单调调严 / C 单调调小守卫
 *
 * C7 进化层安全包络参数进化方向校验。防 agent 自降门槛：
 *   - acceptanceThreshold 只能调严（`next >= prev`，持平合法）；
 *   - archiveCapC 只能调小（`next <= prev`，持平合法）；
 *   - canaryRatio 单调方向 spec 未提及，不纳入门（ERRATA-w2plus L0S-T13）。
 *
 * 复用：bigpowers `gate-trace` 确定性 traceability 闸（确定性方向裁决）。
 */

/** 包络参数差异（`EnvelopeRegistry.diff` 产出）。 */
export interface EnvelopeDiff {
  /** 新增的 canary payload（next - prev）。 */
  canaryAdded: string[];
  /** archiveCapC 变化（next - prev；负=收紧）。 */
  cDelta: number;
  /** acceptanceThreshold 变化（next - prev；正=调严）。 */
  acceptanceDelta: number;
  /** canaryRatio 变化（next - prev；不纳入门）。 */
  canaryRatioDelta: number;
}

/**
 * 断言差异方向单调收紧：
 *   - acceptanceDelta >= 0（acceptance 只能调严或持平）；
 *   - cDelta <= 0（C 只能调小或持平）；
 *   - canaryRatioDelta 不检查（spec 未提及，不纳入门）。
 *
 * @param diff `EnvelopeRegistry.diff` 产出的差异。
 * @throws acceptance 放宽（acceptanceDelta < 0）或 C 放大（cDelta > 0）
 */
export function assertMonotonicStricter(diff: EnvelopeDiff): void {
  if (diff.acceptanceDelta < 0) {
    throw new Error(
      `acceptanceThreshold can only tighten (next >= prev); got delta=${diff.acceptanceDelta}`,
    );
  }
  if (diff.cDelta > 0) {
    throw new Error(
      `archiveCapC can only shrink (next <= prev); got delta=${diff.cDelta}`,
    );
  }
}
