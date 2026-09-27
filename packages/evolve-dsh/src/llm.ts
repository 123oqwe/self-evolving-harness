// PLG-T11: dsh LLM port — 透传外部注入（dsh 无独立 headless CLI 契约）。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
// 本包不自带 LLM 实现：构造 DshAdapter 时由 opts.llmPort 透传（RealLLMPort via
// pi 或其他）。此文件仅重导出类型，保持包结构对称（与 codex/opencode llm.ts 一致）。

export type { LLMPort } from "@harness/l3-engine";
