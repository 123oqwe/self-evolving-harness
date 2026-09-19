// TL-T03: OTel GenAI 语义约定发射器（gen_ai.* spans/events + trace 传播）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T03）的 Given/When/Then 全部场景：
//   1. LLM call → span name = '{operation} {model}'，required gen_ai.* attrs 齐全，
//      usage 五子类型作 span attrs，traceId/spanId 非空
//   2. full messages 作 structured event（非 span attr）
//   3. 50 个 LLM call 嵌套 → exportSpans 形成完整父-子树，无孤儿 span
//   4. subagent trace context 传播：conversation.id 一致 + agent.id 隔离
//   5. tool-exec span：parentSpanId 正确且不带 gen_ai.* attrs
//   6. span 缺 gen_ai.operation.name → MissingRequiredAttrError（static-core 契约）
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect } from "vitest";
import { createOtelEmitter } from "@harness/telemetry";
import type {
  OtelEmitter,
  Span,
  Context,
  GenAiSpan,
  Usage,
} from "@harness/telemetry";
import { MissingRequiredAttrError } from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 OtelEmitter 接口与 GenAiSpan 公共类型（static-core 字段名）。
// Span/Context 为不透明类型（源自 @opentelemetry/api）；测试不直接构造 Span，
// 而是通过 emitter 的工厂方法取得。GenAiSpan 的 `attributes` 为固定键对象；
// 为断言 structured event，此处假设 GenAiSpan 额外暴露 `events?` 字段——
// spec 数据契约 GenAiSpan 未列 events 字段，见文末 ambiguities。
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4.5";
const CONV = "conv-1";
const SESSION = "sess-1";
const AGENT = "parent-A";

function sampleUsage(over: Partial<Usage> = {}): Usage {
  return {
    input: 1_000,
    output: 200,
    cache_read: 500,
    cache_creation: 0,
    reasoning: 0,
    ...over,
  };
}

function llmCtx(over: Partial<{
  operation: string;
  model: string;
  conversationId: string;
  agentId: string;
  userId: string;
  sessionId: string;
}> = {}) {
  return {
    operation: "chat",
    model: MODEL,
    conversationId: CONV,
    agentId: AGENT,
    sessionId: SESSION,
    ...over,
  };
}

// required gen_ai.* attr 键集合（spec §TL-T03 行为规范 1）
const REQUIRED_ATTRS = [
  "gen_ai.operation.name",
  "gen_ai.system",
  "gen_ai.request.model",
  "gen_ai.conversation.id",
  "gen_ai.agent.id",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.cache_read_input_tokens",
  "gen_ai.usage.cache_creation_input_tokens",
] as const;

// usage 五子类型 → span attr 键映射（spec：usage 作 span attrs）
const USAGE_ATTR_KEYS = {
  input: "gen_ai.usage.input_tokens",
  output: "gen_ai.usage.output_tokens",
  cache_read: "gen_ai.usage.cache_read_input_tokens",
  cache_creation: "gen_ai.usage.cache_creation_input_tokens",
  reasoning: "gen_ai.usage.reasoning_output_tokens",
} as const;

function attrOf(span: GenAiSpan, key: string): unknown {
  return (span.attributes as Record<string, unknown>)[key];
}

// ---------------------------------------------------------------------------
// TL-T03
// ---------------------------------------------------------------------------
describe("TL-T03", () => {
  // -------------------------------------------------------------------------
  // 场景 1a + RED 名: "span name = '{operation} {model}'"
  //   Given 一个 LLM call（operation='chat', model='claude-sonnet-4.5'）
  //   When  startLLMSpan + endLLMSpan(usage)
  //   Then  span name = 'chat claude-sonnet-4.5'，traceId/spanId 非空
  // -------------------------------------------------------------------------
  it("span name = '{operation} {model}'", () => {
    const emitter = createOtelEmitter();
    const span = emitter.startLLMSpan(llmCtx());
    emitter.endLLMSpan(span, sampleUsage());

    const spans = emitter.exportSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const s = spans[spans.length - 1]!;
    expect(s.name).toBe("chat claude-sonnet-4.5");
    expect(typeof s.traceId).toBe("string");
    expect(s.traceId.length).toBeGreaterThan(0);
    expect(typeof s.spanId).toBe("string");
    expect(s.spanId.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 场景 1b + RED 名: "required gen_ai.* attrs 齐全"
  //   Given LLM call
  //   When  startLLMSpan + endLLMSpan
  //   Then  attributes 含全部 required gen_ai.* 键
  // -------------------------------------------------------------------------
  it("required gen_ai.* attrs 齐全", () => {
    const emitter = createOtelEmitter();
    const span = emitter.startLLMSpan(llmCtx());
    emitter.endLLMSpan(span, sampleUsage());

    const s = emitter.exportSpans().at(-1)!;
    for (const key of REQUIRED_ATTRS) {
      expect(s.attributes).toHaveProperty(key);
      const v = attrOf(s, key);
      expect(v).not.toBeUndefined();
      expect(v).not.toBeNull();
    }
    // operation name / model 落值正确
    expect(attrOf(s, "gen_ai.operation.name")).toBe("chat");
    expect(attrOf(s, "gen_ai.request.model")).toBe(MODEL);
    expect(attrOf(s, "gen_ai.conversation.id")).toBe(CONV);
    expect(attrOf(s, "gen_ai.agent.id")).toBe(AGENT);
  });

  // -------------------------------------------------------------------------
  // 场景 1c + RED 名: "usage 五子类型作 span attrs"
  //   Given endLLMSpan(span, usage)
  //   Then  span attributes 含五子类型对应 gen_ai.usage.* 键且值匹配
  // -------------------------------------------------------------------------
  it("usage 五子类型作 span attrs", () => {
    const emitter = createOtelEmitter();
    const usage = sampleUsage();
    const span = emitter.startLLMSpan(llmCtx());
    emitter.endLLMSpan(span, usage);

    const s = emitter.exportSpans().at(-1)!;
    expect(attrOf(s, USAGE_ATTR_KEYS.input)).toBe(usage.input);
    expect(attrOf(s, USAGE_ATTR_KEYS.output)).toBe(usage.output);
    expect(attrOf(s, USAGE_ATTR_KEYS.cache_read)).toBe(usage.cache_read);
    expect(attrOf(s, USAGE_ATTR_KEYS.cache_creation)).toBe(usage.cache_creation);
    // reasoning 为可选键：若落盘须值匹配（0 也合法）
    const reasoningAttr = attrOf(s, USAGE_ATTR_KEYS.reasoning);
    if (reasoningAttr !== undefined) {
      expect(reasoningAttr).toBe(usage.reasoning);
    }
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "full messages 作 structured event 非 attr"
  //   Given emitMessageEvent(span, messages)
  //   Then  messages 作 structured event 落 span，而非 span attribute
  //         （event 可采样省存储；messages 不得塞进 attributes）
  // -------------------------------------------------------------------------
  it("full messages 作 structured event 非 attr", () => {
    const emitter = createOtelEmitter();
    const span = emitter.startLLMSpan(llmCtx());
    const messages = [
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi" },
    ];
    emitter.emitMessageEvent(span, messages);
    emitter.endLLMSpan(span, sampleUsage());

    const s = emitter.exportSpans().at(-1)!;
    // messages 不得出现在 attributes 中（不是 attr）
    const attrVals = Object.values(s.attributes as Record<string, unknown>);
    for (const v of attrVals) {
      expect(v).not.toEqual(messages);
      expect(v).not.toBe(messages);
    }
    // messages 作为 structured event 落 span（假设 GenAiSpan.events 字段，见 ambiguities）
    const events = (s as unknown as { events?: unknown[] }).events;
    expect(Array.isArray(events)).toBe(true);
    expect((events as unknown[]).length).toBeGreaterThan(0);
    // event payload 含原始 messages（行为门：full messages 真落 event）
    const found = (events as Array<{ attributes?: unknown }>).some(
      (e) => e.attributes === messages,
    );
    expect(found).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "50 LLM call 父-子树完整无孤儿"
  //   Given 50 个 LLM call 嵌套调用
  //   When  exportSpans
  //   Then  形成完整父-子树（每个子 span parentSpanId 指向已存在 span），无孤儿 span
  // -------------------------------------------------------------------------
  it("50 LLM call 父-子树完整无孤儿", () => {
    const emitter = createOtelEmitter();
    const started: Span[] = [];
    for (let i = 0; i < 50; i++) {
      const span = emitter.startLLMSpan(llmCtx());
      started.push(span);
    }
    for (const s of started) emitter.endLLMSpan(s, sampleUsage());

    const spans = emitter.exportSpans();
    expect(spans.length).toBe(50);

    // 全部共享同一 traceId（trace 上下文一致传播）
    const traceIds = new Set(spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);

    // 无孤儿：任何 parentSpanId（若定义）必须指向已存在 spanId
    const spanIds = new Set(spans.map((s) => s.spanId));
    const orphans = spans.filter(
      (s) => s.parentSpanId !== undefined && !spanIds.has(s.parentSpanId),
    );
    expect(orphans).toEqual([]);

    // 树非平凡：至少存在一个非根 span（有 parentSpanId）—— 压力测试嵌套语义
    const nonRoots = spans.filter((s) => s.parentSpanId !== undefined);
    expect(nonRoots.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "subagent trace context 传播: conversation.id 一致 + agent.id 隔离"
  //   Given parent span S1 启动 subagent
  //   When  propagateToSubagent(S1.ctx, 'sub-B') 后启动子 LLM span
  //   Then  子 span parentSpanId=S1.spanId，gen_ai.agent.id='sub-B'，
  //         gen_ai.conversation.id 与 S1 相同
  // -------------------------------------------------------------------------
  it("subagent trace context 传播: conversation.id 一致 + agent.id 隔离", () => {
    const emitter = createOtelEmitter();
    const parent = emitter.startLLMSpan(llmCtx({ agentId: AGENT }));

    // 取 parent 的 context（Span 作为 Context 传递，见 ambiguities）
    const parentCtx = parent as unknown as Context;
    const subCtx = emitter.propagateToSubagent(parentCtx, "sub-B");

    // 在子 context 下启动子 agent 的 LLM span
    const child = emitter.startLLMSpan(
      llmCtx({ agentId: "sub-B" }) /* impl 经 active/传入 ctx 关联 */,
    );
    emitter.endLLMSpan(parent, sampleUsage());
    emitter.endLLMSpan(child, sampleUsage());

    // 传播返回的 context 须非空（可继续用于关联子 span）
    expect(subCtx).toBeDefined();

    const spans = emitter.exportSpans();
    const parentSpan = spans.find((s) => attrOf(s, "gen_ai.agent.id") === AGENT);
    const childSpan = spans.find(
      (s) => attrOf(s, "gen_ai.agent.id") === "sub-B",
    );
    expect(parentSpan).toBeDefined();
    expect(childSpan).toBeDefined();

    // conversation.id 一致（跨 agent 边界传播）
    expect(attrOf(childSpan!, "gen_ai.conversation.id")).toBe(
      attrOf(parentSpan!, "gen_ai.conversation.id"),
    );
    // agent.id 隔离：子 span agent.id='sub-B'，父保持 'parent-A'
    expect(attrOf(childSpan!, "gen_ai.agent.id")).toBe("sub-B");
    expect(attrOf(parentSpan!, "gen_ai.agent.id")).toBe(AGENT);
    // 子 span 的 parentSpanId 指向父 span（trace 传播链接）
    expect(childSpan!.parentSpanId).toBe(parentSpan!.spanId);
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "tool-exec span parentSpanId 正确且不带 gen_ai.*"
  //   Given 非-LLM span（tool 执行）
  //   When  startToolSpan(toolName, parentSpanId)
  //   Then  span 不带 gen_ai.* attrs 但 parentSpanId 正确（不丢）
  // -------------------------------------------------------------------------
  it("tool-exec span parentSpanId 正确且不带 gen_ai.*", () => {
    const emitter = createOtelEmitter();
    const parent = emitter.startLLMSpan(llmCtx());
    const parentSpanId = (parent as unknown as { spanId: string }).spanId;
    const tool = emitter.startToolSpan("bash", parentSpanId);

    // tool span 须有 spanId（真实 span）
    expect(typeof (tool as unknown as { spanId: string }).spanId).toBe(
      "string",
    );

    const spans = emitter.exportSpans();
    // 找到 tool span：不含 gen_ai.* attrs 的那个
    const toolSpan = spans.find(
      (s) => !Object.keys(s.attributes as Record<string, unknown>).some((k) =>
        k.startsWith("gen_ai."),
      ),
    );
    expect(toolSpan).toBeDefined();
    // tool span parentSpanId 正确指向父
    expect(toolSpan!.parentSpanId).toBe(parentSpanId);
    // tool span 不带任何 gen_ai.* attr
    for (const key of Object.keys(toolSpan!.attributes as Record<string, unknown>)) {
      expect(key.startsWith("gen_ai.")).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 场景 6 + RED 名: "缺 gen_ai.operation.name → MissingRequiredAttrError"
  //   Given span 缺 gen_ai.operation.name
  //   When  endLLMSpan
  //   Then  抛 MissingRequiredAttrError（static-core 契约）
  //
  // 说明：startLLMSpan 的 ctx 形参 operation 为必填；此处用空串模拟"缺"，
  // 并 cast 绕过 TS 必填检查。见 ambiguities。
  // -------------------------------------------------------------------------
  it("缺 gen_ai.operation.name → MissingRequiredAttrError", () => {
    const emitter = createOtelEmitter();
    // 真正剔除 operation 键模拟「缺 gen_ai.operation.name」（非空串伪缺），
    // cast 绕过 TS 必填检查。faithful impl 检查 undefined 须抛错。
    const { operation: _omit, ...ctxWithoutOp } = llmCtx();
    void _omit;
    const span = emitter.startLLMSpan(
      ctxWithoutOp as unknown as ReturnType<typeof llmCtx>,
    );
    expect(() => emitter.endLLMSpan(span, sampleUsage())).toThrowError(
      MissingRequiredAttrError,
    );
    // 同时校验错误信息含类名 / required attr 语义
    expect(() => emitter.endLLMSpan(span, sampleUsage())).toThrow(
      /MissingRequiredAttrError|operation/i,
    );
  });
});
