// evolve-cli · LLMPort 显式注入裁决（PLG-T08 llmPort 歧义）。
//
// 歧义裁决（spec 执行提示 (3) + 任务指令）：默认要求**显式注入**——
//   (a) 编程 API：RunOptions.llmPort（测试 FakeLLM / 宿主注入）；
//   (b) 环境配置：EVOLVE_LLM_BASE_URL + EVOLVE_LLM_API_KEY + EVOLVE_LLM_MODEL
//       三元组 → HttpLlmPort（OpenAI-compatible chat/completions，仅用
//       Node 20+ 内置 fetch，零新依赖）；
//   (c) CLI --llm <url> 等价覆盖 EVOLVE_LLM_BASE_URL。
// 未显式配置 → LlmPortNotConfiguredError（不静默回退 / 不硬依赖 pi 子进程——
// RealLLMPort via pi 属 REAL-T01，本包 scope 外）。

import type { LLMPort } from "@harness/l3-engine";

/** llmPort 未显式配置（fail-closed，不静默回退）。 */
export class LlmPortNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmPortNotConfiguredError";
  }
}

export interface HttpLlmConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** OpenAI-compatible HTTP LLM port（Node 内置 fetch，零依赖）。 */
export class HttpLlmPort implements LLMPort {
    private readonly cfg: HttpLlmConfig;
  constructor(cfg: HttpLlmConfig) { this.cfg = cfg; }
  async complete(prompt: string): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`llm request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("llm response missing choices[0].message.content");
    }
    return content;
  }
}

/** 从 env 提取 HTTP LLM 配置（三元组缺任一 → null）。 */
export function httpLlmConfigFromEnv(env: Record<string, string | undefined>): HttpLlmConfig | null {
  const baseUrl = env.EVOLVE_LLM_BASE_URL;
  const apiKey = env.EVOLVE_LLM_API_KEY;
  const model = env.EVOLVE_LLM_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 解析 LLMPort：显式注入优先，其次 env 三元组，否则 fail-closed。
 *
 * @param explicit 编程注入的 LLMPort（RunOptions.llmPort / 测试 FakeLLM）。
 * @param env 环境变量（EVOLVE_LLM_BASE_URL/API_KEY/MODEL）。
 * @param llmFlag CLI `--llm <url>`（覆盖 EVOLVE_LLM_BASE_URL）。
 */
export function resolveLlmPort(
  explicit: LLMPort | undefined,
  env: Record<string, string | undefined>,
  llmFlag?: string,
): LLMPort {
  if (explicit) return explicit;
  const merged = llmFlag
    ? { ...env, EVOLVE_LLM_BASE_URL: llmFlag }
    : env;
  const cfg = httpLlmConfigFromEnv(merged);
  if (cfg) return new HttpLlmPort(cfg);
  throw new LlmPortNotConfiguredError(
    "llmPort not configured: pass RunOptions.llmPort (programmatic injection) " +
    "or set EVOLVE_LLM_BASE_URL + EVOLVE_LLM_API_KEY + EVOLVE_LLM_MODEL " +
    "(or --llm <url> with env key/model). Explicit injection required; " +
    "no implicit pi-subprocess fallback (RealLLMPort via pi is REAL-T01, out of scope).",
  );
}
