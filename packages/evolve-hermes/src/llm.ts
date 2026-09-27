// PLG-T04: evolve-hermes · LLMPort 透传。
//
// Spec: execution/plugin/TASKS.md §PLG-T04。Hermes 无独立 headless CLI 契约，
// 透传外部注入 LLMPort（RealLLMPort via pi 或其他）。本文件仅做类型再导出，
// 便于消费方经 @harness/evolve-hermes 统一拿 LLMPort 类型。

export type { LLMPort } from "@harness/l3-engine";
