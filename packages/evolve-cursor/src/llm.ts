// PLG-T06: Cursor LLM port — 透传外部注入。
//
// Spec: execution/plugin/TASKS.md §PLG-T06 (llm.ts)。
// 复用铁律（§0.2）：Cursor 无独立 headless CLI 调用契约，LLM 透传外部注入的
// LLMPort（RealLLMPort via 外部，测试用 FakeLLM）。本文件只提供透传 helper +
// 类型再导出，不重造 LLM 调用逻辑。

import type { LLMPort } from "@harness/l3-engine";

export type { LLMPort };

/**
 * 透传外部注入的 LLMPort（identity helper，显式命名「透传」语义）。
 * Cursor 无原生 headless LLM CLI 契约，故 adapter 不自己 spawn——
 * 调用方注入什么，adapter 就用什么。
 */
export function passThroughLLM(llm: LLMPort): LLMPort {
  return llm;
}
