/**
 * L0S-T09 — C3 typed action 分类器共享类型。
 *
 * ActionVerdict = 分类器对单个 typed action 的裁决：
 *   - `allow`：放行（known-safe）；
 *   - `deny`：拒绝（known-destructive / known-exfil）；
 *   - `ask`：转人工确认（spec GWT 未覆盖，实现须支持该分支，裁决 L0S-T09）。
 */

export type ActionVerdict = "allow" | "deny" | "ask";

/** `classify` 单次裁决结果。 */
export interface ClassifyResult {
  verdict: ActionVerdict;
  /** 置信度 ∈ [0,1]（规则基线 = 1.0）。 */
  confidence: number;
  /** 人类可读理由（非空）。 */
  reason: string;
}

/** F1 安全套件评估指标。 */
export interface SafetyMetrics {
  /** F1（正类 = deny）。 */
  f1: number;
  /** 精确率。 */
  precision: number;
  /** 召回率。 */
  recall: number;
  /** 去偏 judge 的位置偏置标准差（swap A/B 不一致率的标准差）。 */
  σ: number;
}
