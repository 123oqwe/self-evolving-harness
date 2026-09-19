// L1-T02 · 共享基质类型（Substrate / VariantCandidate / RecallSignal）
//
// 抽到独立模块供 T03（phase substrate）/ T04 / T05（变异候选）复用。
// 字段名与可选性严格对齐 execution/L1-config/TASKS.md §L1-T02 接口签名。

/**
 * 被进化基质（compaction / phase prompt）的只读视图。
 * `activePath` 为相对 repo root 的 posix 路径（如 `prompts/compaction-summary.md`）。
 */
export interface Substrate {
  readonly kind: "compaction" | "phase";
  readonly activePath: string;
  readonly content: string;
}

/**
 * 变异候选（元循环产出，落 `staging/`，不进 active）。
 * 由 T04a/T05a 的 evolution-driver 产出，T04b/T05b 的 select-retain 消费。
 * 此处仅定义最小共享形状，后续任务可扩展。
 */
export interface VariantCandidate {
  readonly kind: "compaction" | "phase";
  readonly variantPath: string;
  readonly content: string;
  readonly source: "mutation" | "human";
}

/**
 * compaction recall 信号：被 summarize 掉的原始工具输出（fullOutputPath）
 * 在 compaction 后被 agent 重读的频次。频次↓ = recall 退化（PRD §9.1）。
 */
export interface RecallSignal {
  readonly substrateSha: string;
  readonly fullOutputPathRereadCount: number;
  readonly sampledAt: number;
}
