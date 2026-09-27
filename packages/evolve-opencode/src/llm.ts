// PLG-T03: OpenCode LLMPort 透传（OpenCode 无独立 headless CLI 契约）。
//
// Spec: execution/plugin/TASKS.md §PLG-T03 (llm.ts).
// 复用铁律（§0.2）：LLMPort 类型从 @harness/l3-engine 导入；本文件只做
// 透传外部注入的 LLMPort，不在插件包内重造 LLM 调用逻辑。

import type { LLMPort } from "@harness/l3-engine";

/**
 * 解析 OpenCodeAdapterOptions.llmPort：必须由外部注入（透传 RealLLMPort via
 * pi 或其他）。本 helper 仅做存在性校验，返回原实例（不包装）。
 */
export function resolveLlmPort(llmPort: LLMPort | undefined): LLMPort {
  if (!llmPort) {
    throw new Error(
      "OpenCodeAdapter requires an injected llmPort (OpenCode has no native headless CLI contract)",
    );
  }
  return llmPort;
}
