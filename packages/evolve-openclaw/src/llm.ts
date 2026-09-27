// PLG-T05: evolve-openclaw · LLMPort 透传。
//
// Spec: execution/plugin/TASKS.md §PLG-T05。OpenClaw 无独立 headless CLI 调用契约，
// 透传外部注入 LLMPort（RealLLMPort via pi 或其他）。本文件仅做类型再导出，
// 便于消费方经 @harness/evolve-openclaw 统一拿 LLMPort 类型（对齐 PLG-T04 hermes/llm.ts）。

export type { LLMPort } from "@harness/l3-engine";
