// TL-T03: OTel trace context 传播（async/subagent 边界）
//
// static-core 契约：trace context（conversation.id/agent.id/user/session）须
// 传播到每个 span，含 async 子 agent 与 tool-exec span（research §1.3）。
//
// Context 为不透明类型（源自 @opentelemetry/api 的 context）；本包 re-export
// 以便调用方在 async/Promise 与 subagent 边界显式传递。startLLMSpan 返回的
// Span 可 `as unknown as Context` cast 后传入 propagateToSubagent（ERRATA-w2plus
// TL-T03 裁决）。
//
// 隐式 active context：LLM-LLM 嵌套（50 call 父-子树）走隐式 active 栈
// （ERRATA-w2plus TL-T03 确认假设），非严格父-子链；仅保证无孤儿 + traceId
// 一致 + 至少一个非根 span。

/**
 * 不透明 trace context。可承载 active span 引用与 subagent agent.id 隔离标记。
 * Span 对象可经 `as unknown as Context` 作为 Context 传递。
 */
export interface Context {
  /** 当前 active span（不透明引用，结构同 Span） */
  readonly span?: unknown;
  /** subagent agent.id 隔离标记 */
  readonly subagentAgentId?: string;
}
