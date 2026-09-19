// CE-T04 REFACTOR + CE-T05 共享：judge model pool 选择 + 模型族提取。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T04/§CE-T05 + ERRATA-w2plus 裁决
// （CE-12/CE-14/CE-15）：
// - “family” 提取规则 = **model id 前缀**：取首个 `-`/`/` 之前的小写 token。
//   例：`openai/gpt-4o` → `openai`、`anthropic/claude-3.5` → `anthropic`、
//   `google/gemini-1.5-pro` → `google`。
// - “judge 与 variant 同模型族”解读为 **judge 与 agent 同模型族**（CE-15），
//   同族 judge 从 pool 剔除并 throw `SameModelFamilyError`。
// - `MAX_REVIEW_ITERATIONS = 5`：fresh-context reviewer 硬上限（PRD §6.2 L1）。

/**
 * fresh-context reviewer 迭代硬上限（PRD §6.2 L1）。
 *
 * reviewer loop 最多 5 轮；超限即截断并落 `iterations=5`，禁止无限重试。
 */
export const MAX_REVIEW_ITERATIONS = 5;

/**
 * judge 与 agent 同模型族（self-preference 错误路径）。
 *
 * 当 judge pool 内全部 judge 与 agent 同模型族时抛出——fresh-context reviewer
 * 须异模型族/异 session（PRD §6.2 L1），同族 judge 会被剔除。
 */
export class SameModelFamilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SameModelFamilyError";
  }
}

/**
 * 从 model id 提取“模型族”前缀。
 *
 * 规则（ERRATA-w2plus CE-12/CE-15）= 取首个 `-`/`/` 之前的小写 token。
 * 空串/undefined → 返回空串（调用方据此判定 pool 为空）。
 *
 * 例：
 *   `openai/gpt-4o`         → `openai`
 *   `anthropic/claude-3.5`  → `anthropic`
 *   `google/gemini-1.5-pro` → `google`
 *   `my-model`              → `my`
 */
export function extractModelFamily(modelId: string): string {
  if (typeof modelId !== "string" || modelId.length === 0) return "";
  const re = /[-/]/;
  const match = re.exec(modelId);
  const prefix = match === null ? modelId : modelId.slice(0, match.index);
  return prefix.toLowerCase();
}

/**
 * 从 judge pool 中选首个与 agent 异模型族的 judge。
 *
 * 同族 judge 全部剔除（CE-15）；pool 内无任何异族 judge → throw `SameModelFamilyError`。
 * 返回值为 judge model id（保留原始大小写，供下游 modelFamily 再提取）。
 */
export function selectCrossFamilyJudge(
  pool: string[],
  agentFamily: string,
): string {
  const normalizedAgent = (agentFamily ?? "").toLowerCase();
  for (const judge of pool) {
    if (extractModelFamily(judge) !== normalizedAgent) {
      return judge;
    }
  }
  throw new SameModelFamilyError(
    `no cross-family judge available: all judges in pool ` +
      `[${pool.join(", ")}] share agent family "${normalizedAgent}"`,
  );
}
