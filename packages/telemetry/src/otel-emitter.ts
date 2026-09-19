// TL-T03: OTel GenAI 语义约定发射器（gen_ai.* spans/events + trace 传播）
//
// static-core 字段名契约（execution/telemetry/TASKS.md §TL-T03 + 数据契约节 +
// ERRATA-w2plus 裁决）：
//   - span name = `{gen_ai.operation.name} {gen_ai.request.model}`
//   - required attrs: gen_ai.operation.name / gen_ai.system / gen_ai.request.model
//     / gen_ai.conversation.id / gen_ai.agent.id + usage 五子类型作 span attrs
//   - full messages 作 structured event（非 attr，可采样）；GenAiSpan.events 字段
//   - trace context（conversation.id/agent.id）跨 async/subagent 边界传播
//   - 缺 gen_ai.operation.name → MissingRequiredAttrError（endLLMSpan 触发）
//
// 复用 vs 自研：spec 建议复用 @opentelemetry/api + @opentelemetry/sdk-trace-base。
// 本包未引入 OTel SDK 依赖（项目禁新增依赖约束），改为自研 in-memory span
// 发射器，字段名/schema 严格对齐 OTel GenAI semantic-conventions。Span/Context
// 为不透明类型 re-export，调用方不感知底层实现。

import type { Context } from "./otel-context";
import type { Usage } from "./transcript-schema";

// ---------------------------------------------------------------------------
// 公共类型（static-core 契约）
// ---------------------------------------------------------------------------

/** OTel GenAI span 的 attributes 形状（static-core 字段名）。 */
export interface GenAiSpanAttributes {
  "gen_ai.operation.name": string;
  "gen_ai.system": string;
  "gen_ai.request.model": string;
  "gen_ai.conversation.id": string;
  "gen_ai.agent.id": string;
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "gen_ai.usage.cache_read_input_tokens": number;
  "gen_ai.usage.cache_creation_input_tokens": number;
  "gen_ai.usage.reasoning_output_tokens"?: number;
  /** 索引签名：允许 tool-exec span 无 gen_ai.* attrs（attributes 为 {}） */
  [key: string]: unknown;
}

/**
 * TL-T03 OTel GenAI span（static-core 字段名）。
 * ERRATA-w2plus TL-T03：须含 `events?` 字段，emitMessageEvent 把 messages
 * 落为 event.attributes。
 */
export interface GenAiSpan {
  name: string; // `{operation} {model}`
  attributes: GenAiSpanAttributes;
  parentSpanId?: string;
  traceId: string;
  spanId: string;
  /** structured events（full messages/tool_defs 作 event，非 attr） */
  events?: Array<{ name?: string; attributes?: Record<string, unknown> }>;
}

/**
 * 不透明 Span 类型（startLLMSpan/startToolSpan 返回值）。
 * 可 `as unknown as Context` cast 后作为 context 传入 propagateToSubagent。
 */
export interface Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly events: Array<{ name?: string; attributes?: Record<string, unknown> }>;
  /** 是否为 tool-exec span（不带 gen_ai.* attrs） */
  readonly isTool: boolean;
  /** 是否已 end */
  ended: boolean;
  /** startLLMSpan ctx 原始 operation（供 endLLMSpan 校验 missing） */
  readonly operation?: string;
}

/** OtelEmitter 接口（spec §TL-T03 接口签名）。 */
export interface OtelEmitter {
  startLLMSpan(ctx: {
    operation: string;
    model: string;
    conversationId: string;
    agentId: string;
    userId?: string;
    sessionId: string;
  }): Span;
  emitMessageEvent(span: Span, messages: unknown[]): void;
  endLLMSpan(span: Span, usage: Usage): void;
  startToolSpan(toolName: string, parentSpanId: string): Span;
  propagateToSubagent(parentCtx: Context, subagentAgentId: string): Context;
  exportSpans(): GenAiSpan[];
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** span 缺 required gen_ai.* attr（如 operation.name）→ 抛此错。
 *  error message 含类名，同时支持 instanceof 与正则匹配。 */
export class MissingRequiredAttrError extends Error {
  constructor(
    message = "MissingRequiredAttrError: required gen_ai.* attribute missing (e.g. gen_ai.operation.name)",
  ) {
    super(message);
    this.name = "MissingRequiredAttrError";
  }
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 生成 OTel 风格 traceId（32 hex）/ spanId（16 hex）。 */
function newTraceId(): string {
  return randomHex(16);
}
function newSpanId(): string {
  return randomHex(8);
}
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// 默认 gen_ai.system 推导（model 前缀 → system 名）
// ---------------------------------------------------------------------------
function deriveSystem(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "claude";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.startsWith("gemini")) return "gemini";
  return "claude";
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 OTel GenAI 发射器（in-memory span 树）。
 * ERRATA-w2plus TL-T03：`createOtelEmitter(opts?)` 工厂签名（缺省参数）。
 */
export function createOtelEmitter(_opts?: {
  /** 可选：覆写默认 gen_ai.system */
  defaultSystem?: string;
}): OtelEmitter {
  // 每个 emitter 实例一个 traceId（同一 trace 内所有 span 共享）。
  const traceId = newTraceId();
  // 全部 span（ended 或未 end）—— exportSpans 返回此列表。
  const spans: Span[] = [];
  // 隐式 active span 指针（LLM-LLM 嵌套走此栈；ERRATA-w2plus 确认假设）。
  let activeSpanId: string | undefined;

  function buildLLMSpan(ctx: {
    operation: string;
    model: string;
    conversationId: string;
    agentId: string;
    userId?: string;
    sessionId: string;
  }): Span {
    const spanId = newSpanId();
    const operation = ctx.operation;
    const attributes: Record<string, unknown> = {
      "gen_ai.operation.name": operation,
      "gen_ai.system": deriveSystem(ctx.model),
      "gen_ai.request.model": ctx.model,
      "gen_ai.conversation.id": ctx.conversationId,
      "gen_ai.agent.id": ctx.agentId,
      // usage 五子类型在 endLLMSpan 落值；先占位保证键存在
      "gen_ai.usage.input_tokens": 0,
      "gen_ai.usage.output_tokens": 0,
      "gen_ai.usage.cache_read_input_tokens": 0,
      "gen_ai.usage.cache_creation_input_tokens": 0,
      "gen_ai.usage.reasoning_output_tokens": 0,
    };
    if (ctx.userId !== undefined) {
      attributes["gen_ai.user.id"] = ctx.userId;
    }
    if (ctx.sessionId !== undefined) {
      attributes["gen_ai.session.id"] = ctx.sessionId;
    }
    const span: Span = {
      spanId,
      traceId,
      ...(activeSpanId !== undefined ? { parentSpanId: activeSpanId } : {}),
      name: `${operation} ${ctx.model}`,
      attributes,
      events: [],
      isTool: false,
      ended: false,
      operation,
    };
    // 新 span 成为 active（隐式 active 栈：下一个 LLM span 以本 span 为父）
    activeSpanId = spanId;
    spans.push(span);
    return span;
  }

  return {
    startLLMSpan(ctx) {
      return buildLLMSpan(ctx);
    },

    emitMessageEvent(span, messages) {
      // full messages 作 structured event（非 attr，可采样）。
      // 行为门：event.attributes 须为原始 messages 引用（===）。
      span.events.push({ name: "messages", attributes: messages as unknown as Record<string, unknown> });
    },

    endLLMSpan(span, usage) {
      // static-core 契约：缺 gen_ai.operation.name → MissingRequiredAttrError。
      // ERRATA-w2plus：缺 operation（含空串/undefined）触发 missing。
      const op = span.operation;
      if (op === undefined || op === null || op === "") {
        throw new MissingRequiredAttrError(
          "MissingRequiredAttrError: gen_ai.operation.name is missing (operation must be a non-empty string)",
        );
      }
      // usage 五子类型作 span attrs
      span.attributes["gen_ai.usage.input_tokens"] = usage.input;
      span.attributes["gen_ai.usage.output_tokens"] = usage.output;
      span.attributes["gen_ai.usage.cache_read_input_tokens"] = usage.cache_read;
      span.attributes["gen_ai.usage.cache_creation_input_tokens"] = usage.cache_creation;
      span.attributes["gen_ai.usage.reasoning_output_tokens"] = usage.reasoning;
      span.ended = true;
    },

    startToolSpan(toolName, parentSpanId) {
      const spanId = newSpanId();
      const span: Span = {
        spanId,
        traceId,
        parentSpanId,
        name: toolName,
        attributes: {}, // tool-exec span 不带 gen_ai.* attrs
        events: [],
        isTool: true,
        ended: false,
      };
      // tool-exec span 不变更 active（非 LLM call）
      spans.push(span);
      return span;
    },

    propagateToSubagent(parentCtx, subagentAgentId) {
      // parentCtx 实为 parent Span（调用方 `as unknown as Context` 传入）。
      // 取其 spanId 作为 active，确保后续子 agent LLM span 经隐式 active
      // 关联到 parent（parentSpanId = parent.spanId）。
      const parentSpanId = (parentCtx as unknown as { spanId?: string }).spanId;
      if (parentSpanId !== undefined) {
        activeSpanId = parentSpanId;
      }
      return { span: parentCtx, subagentAgentId };
    },

    exportSpans() {
      // 返回全部 span（ended 或未 end），形状对齐 GenAiSpan。
      return spans as unknown as GenAiSpan[];
    },
  };
}
