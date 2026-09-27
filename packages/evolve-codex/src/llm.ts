// PLG-T02: Codex LLM port 透传 helper。
//
// Spec: execution/plugin/TASKS.md §PLG-T02 (llm.ts)。
// 复用铁律（§0.2）：Codex 无独立 headless CLI 调用契约（非 `codex -p` 形态），
// 本插件不实现 LLM 调用——LLMPort 由外部注入（RealLLMPort via pi 或其他），
// 本文件仅提供透传/类型再导出，便于 index.ts 统一导出。

import type { LLMPort } from "@harness/l3-engine";

/** 透传外部注入的 LLMPort（identity helper，便于显式标注来源）。 */
export function passThroughLlmPort(llmPort: LLMPort): LLMPort {
  return llmPort;
}

export type { LLMPort };
