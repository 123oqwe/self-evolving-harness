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
 * 变异候选（元循环产出）。
 * 由 T04a/T05a 的 evolution-driver 产出（只产候选集，不打分不落盘——
 * spec §L1-T04a：「本任务只产候选集，打分与 select 在 T04b」），
 * T04b/T05b 的 select-retain 消费并经 commit-on-success 落 active + staging。
 *
 * 字段名/可选性严格对齐 execution/L1-config/TASKS.md §L1-T04a 接口签名
 * （ERRATA-w2plus L1-02/L1-03 裁决：SandboxExecutor shape + opts 可选字段）。
 */
export interface VariantCandidate {
  /** uuid */
  readonly id: string;
  readonly substrate: "compaction";
  /** baseline sha（变异父本 sha256） */
  readonly parentSha: string;
  /** 变异后的 prompt 全文 */
  readonly content: string;
  readonly provenance: {
    readonly trajectoryId: string;
    readonly mutatorSession: string;
    readonly generatedAt: number;
  };
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
