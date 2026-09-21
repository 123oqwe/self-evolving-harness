/**
 * L0S-T13 — ABC checklist 审计（empty-response 不算 pass）
 *
 * τ-bench 38% 教训：empty-response（`response === ""`）不应被计为成功。
 * 即使 canary result 标记 `passed=true`，若 response 为空串，视为假 pass，
 * 不计入真实 pass，且当 empty-response 占比 > 0 时整体 `pass=false`。
 *
 * 复用：arXiv:2507.02825 ABC checklist；CE-T01c ABC 审计对接（复用本判定逻辑）。
 */

/** canary 运行结果（ERRATA-w2plus L0S-T13：形状 `{ response, passed }`）。 */
export interface CanaryResult {
  /** canary 触发后捕获的响应文本；空串表示 empty-response。 */
  response: string;
  /** 原始通过标记（empty-response 的假 pass 由本审计剔除）。 */
  passed: boolean;
}

/** ABC 审计结果。 */
export interface AbcAuditResult {
  /** 整体是否通过（empty-response 占比 > 0 → false）。 */
  pass: boolean;
  /** empty-response 占比（0..1）。 */
  emptyResponseRate: number;
}

/**
 * ABC 审计：剔除 empty-response 假 pass。
 *
 *   - emptyResponseRate = empty-response 数 / 总数；
 *   - pass = emptyResponseRate === 0 且存在至少一条真实非空 pass（或空集视场景：
 *     空集 audit pass=false，无证据不算通过）。
 *
 * 实现：empty-response（`response === ""`）的条目即使 `passed=true` 也不算 pass；
 * 当 emptyResponseRate > 0 时整体 `pass=false`。
 */
export function abcAudit(canaryResults: CanaryResult[]): AbcAuditResult {
  const total = canaryResults.length;
  if (total === 0) {
    return { pass: false, emptyResponseRate: 0 };
  }
  let emptyCount = 0;
  for (const r of canaryResults) {
    if (r.response === "") {
      emptyCount += 1;
    }
  }
  const emptyResponseRate = emptyCount / total;
  // empty-response 不算 pass：只要存在 empty-response，整体不通过。
  const pass = emptyResponseRate === 0;
  return { pass, emptyResponseRate };
}
