// L0C-T02: turn 定义 + transcript 协议契约
//
// 覆盖 spec（execution/L0-core/TASKS.md §L0C-T02）的 Given/When/Then 全部场景：
//   1. tool_use id="t1" + 紧随 tool_result tool_use_id="t1" → assertToolUsePaired 通过（正常路径）
//   2. tool_result tool_use_id="t1" 无对应 tool_use → throw OrphanToolResultError statusCode=400（错误路径）
//   2b. tool_use id="t1" + tool_result tool_use_id="t2"（id 不匹配）→ throw OrphanToolResultError statusCode=400（反位置型桩）
//   2c. tool_result 出现在其 tool_use 之前 → throw OrphanToolResultError statusCode=400（锁“紧随”语义）
//   3. assistant 含 tool_use 且 tool_result 未到达 → mid_turn flush 被拒（isLegalInsertionPoint("mid_turn")===false）
//   4. turn_end（所有 tool_result 已到达且 id 配对）→ isLegalInsertionPoint("turn_end")===true 且 flush 成功
//   4b. tool_result 数量匹配但 id 不匹配 → isLegalInsertionPoint("turn_end")===false 且 flush 被拒（反 length-only 桩）
//   5. tool_result content 含 null → normalizeContent throw
//
// RED state: 模块尚未实现，从 `@harness/l0-core` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect } from "vitest";
import {
  assertToolUsePaired,
  normalizeContent,
  OrphanToolResultError,
  createTurnStateMachine,
} from "@harness/l0-core";
import type {
  ContentBlock,
  AssistantMessage,
  ToolResult,
  TurnStateMachine,
} from "@harness/l0-core";

// ---------------------------------------------------------------------------
// 辅助构造器
//
// 说明：spec 仅给出 ContentBlock / Turn / TurnStateMachine 的接口契约，
// 未给出 AssistantMessage 的精确字段集，也未给出 TurnStateMachine 的构造入口。
// 此处按最小可工作假设：
//   - AssistantMessage 至少含 `content: ContentBlock[]`（含 tool_use 块）；
//   - 工厂 `createTurnStateMachine(assistant, toolResults)` 由 assistant 中的 tool_use
//     与已到达的 toolResults 推导 phase：全部 tool_use 均有匹配 tool_result → "turn_end"，
//     否则 → "awaiting_tool_results"（mid_turn）。
// 见文末 ambiguities。
// ---------------------------------------------------------------------------

function assistantWithToolUse(id: string, name = "tool"): AssistantMessage {
  const block: ContentBlock = { type: "tool_use", id, name, input: {} };
  return { content: [block] } as unknown as AssistantMessage;
}

function assistantText(text: string): AssistantMessage {
  const block: ContentBlock = { type: "text", text };
  return { content: [block] } as unknown as AssistantMessage;
}

function toolResult(toolUseId: string, isError = false): ToolResult {
  // 构造一个合法的 tool_result ContentBlock；ToolResult 类型与 tool_result ContentBlock 同构。
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: "ok",
    is_error: isError,
  } as unknown as ToolResult;
}

function toolResultBlock(toolUseId: string, content: ContentBlock[] | string): ContentBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
  };
}

// ---------------------------------------------------------------------------
// L0C-T02
// ---------------------------------------------------------------------------
describe("L0C-T02", () => {
  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "pairs tool_use_id round-trip"
  //   Given 一条 assistant 含 tool_use id="t1" + 紧随 tool_result tool_use_id="t1"
  //   When  assertToolUsePaired
  //   Then  通过（正常路径，不 throw）
  // -------------------------------------------------------------------------
  it("pairs tool_use_id round-trip", () => {
    const transcript: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "tool", input: {} },
      toolResultBlock("t1", "result"),
    ];

    // 正常路径：不抛异常即通过
    expect(() => assertToolUsePaired(transcript)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "rejects orphan tool_result with 400"
  //   Given tool_result tool_use_id="t1" 但无对应 tool_use
  //   When  assertToolUsePaired
  //   Then  throw OrphanToolResultError 且 err.statusCode===400
  // -------------------------------------------------------------------------
  it("rejects orphan tool_result with 400", () => {
    const transcript: ContentBlock[] = [
      // 孤儿 tool_result：无对应 tool_use
      toolResultBlock("t1", "result"),
    ];

    let caught: unknown = null;
    try {
      assertToolUsePaired(transcript);
    } catch (err) {
      caught = err;
    }

    // 必须抛 OrphanToolResultError 实例
    expect(caught).toBeInstanceOf(OrphanToolResultError);
    const err = caught as OrphanToolResultError;
    // statusCode 必须=400（与 Anthropic API 孤儿 tool_result 400 对齐，非 422）
    expect(err.statusCode).toBe(400);
    // 错误消息须实质（非空）
    expect(typeof err.message).toBe("string");
    expect(err.message.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 场景 2b + RED 名: "rejects mismatched tool_use_id with 400"
  //   Given tool_use id="t1" + 紧随 tool_result tool_use_id="t2"（id 不匹配任何 tool_use）
  //   When  assertToolUsePaired
  //   Then  throw OrphanToolResultError 且 err.statusCode===400
  //
  // 反蒙混：仅检查"首块是否为 tool_result"的位置型桩函数会被挂掉——
  // 此 transcript 首块是 tool_use，桩函数不会抛，但真实实现须因 id 不匹配而抛错。
  // -------------------------------------------------------------------------
  it("rejects mismatched tool_use_id with 400", () => {
    const transcript: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "tool", input: {} },
      // tool_result 的 tool_use_id 与任何 tool_use 都不匹配
      toolResultBlock("t2", "result"),
    ];

    let caught: unknown = null;
    try {
      assertToolUsePaired(transcript);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OrphanToolResultError);
    const err = caught as OrphanToolResultError;
    expect(err.statusCode).toBe(400);
    expect(typeof err.message).toBe("string");
    expect(err.message.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 场景 2c + RED 名: "rejects out-of-order tool_result before its tool_use"
  //   Given tool_result tool_use_id="t1" 出现在 tool_use id="t1" 之前（乱序）
  //   When  assertToolUsePaired
  //   Then  throw OrphanToolResultError 且 err.statusCode===400
  //
  // 锁定"紧随"语义：tool_result 必须出现在其 tool_use 之后，
  // 先于 tool_use 出现的 tool_result 视为孤儿。
  // -------------------------------------------------------------------------
  it("rejects out-of-order tool_result before its tool_use", () => {
    const transcript: ContentBlock[] = [
      // tool_result 出现在其 tool_use 之前
      toolResultBlock("t1", "result"),
      { type: "tool_use", id: "t1", name: "tool", input: {} },
    ];

    let caught: unknown = null;
    try {
      assertToolUsePaired(transcript);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OrphanToolResultError);
    const err = caught as OrphanToolResultError;
    expect(err.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + 场景 4 + RED 名: "flushes pending only at turn_end"
  //   Given assistant 含 tool_use 且 tool_result 尚未到达
  //   When  在 mid_turn 点 flush / 查 isLegalInsertionPoint
  //   Then  isLegalInsertionPoint("mid_turn")===false 且 flush 被拒绝（throw）
  //
  //   Given turn_end（所有 tool_result 已到达）
  //   When  isLegalInsertionPoint("turn_end")
  //   Then  true 且 flush 成功（不 throw）
  // -------------------------------------------------------------------------
  it("flushes pending only at turn_end", () => {
    // —— 场景 3：mid_turn，tool_result 未到达 ——
    const midTurnMachine: TurnStateMachine = createTurnStateMachine(
      assistantWithToolUse("t1"),
      [], // 尚无 tool_result 到达
    );

    // mid_turn 不是合法插入点
    expect(midTurnMachine.isLegalInsertionPoint("mid_turn")).toBe(false);
    // mid_turn flush 必须被拒绝（防孤儿 tool_use_id）
    expect(() => midTurnMachine.flushPending()).toThrow();

    // —— 场景 4：turn_end，所有 tool_result 已到达 ——
    const turnEndMachine: TurnStateMachine = createTurnStateMachine(
      assistantWithToolUse("t1"),
      [toolResult("t1")], // tool_result 已到达 → 全部配对
    );

    // turn_end 是合法插入点
    expect(turnEndMachine.isLegalInsertionPoint("turn_end")).toBe(true);
    // turn_end flush 成功（不 throw）
    expect(() => turnEndMachine.flushPending()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 场景 4b + RED 名: "turn_end requires id-matched tool_results"
  //   Given assistant 含 tool_use id="t1" + 一个 tool_result 但 tool_use_id="t2"（id 不匹配）
  //   When  isLegalInsertionPoint("turn_end") / flushPending
  //   Then  isLegalInsertionPoint("turn_end")===false 且 flushPending throw
  //
  // 反蒙混：仅按 tool_result 计数推进 phase 的 length-only 桩函数会被挂掉——
  // 此处 tool_result.length===1 与 tool_use 数量相等，桩函数会判 turn_end===true，
  // 但真实实现须因 id 不匹配而拒绝 turn_end。
  // -------------------------------------------------------------------------
  it("turn_end requires id-matched tool_results", () => {
    const mismatchMachine: TurnStateMachine = createTurnStateMachine(
      assistantWithToolUse("t1"),
      [toolResult("t2")], // 数量匹配但 id 不匹配
    );

    // id 不匹配 → 不是合法 turn_end 插入点
    expect(mismatchMachine.isLegalInsertionPoint("turn_end")).toBe(false);
    // flush 必须被拒绝（仍有未配对的 tool_use）
    expect(() => mismatchMachine.flushPending()).toThrow();
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "rejects null content in tool_result"
  //   Given 一个 tool_result content 含 null（模拟 untyped extension handler 注入）
  //   When  normalizeContent
  //   Then  throw（防 null content 进 state/history）
  // -------------------------------------------------------------------------
  it("rejects null content in tool_result", () => {
    // 运行时注入 null content（TS 类型本不允许，模拟 untyped extension handler）
    const nullContentBlock = {
      type: "tool_result",
      tool_use_id: "t1",
      content: null,
    } as unknown as ContentBlock;

    // normalizeContent 必须递归 reject null content
    expect(() => normalizeContent(nullContentBlock)).toThrow();
  });

  // -------------------------------------------------------------------------
  // 补充：tool_result content 数组中含 null 元素也应被 normalizeContent 拒绝
  // （spec 执行提示明确"content 归一化必须递归"；此处测 tool_result content 数组内的 null）
  // -------------------------------------------------------------------------
  it("rejects null element inside tool_result content array", () => {
    const blockWithNullElement = {
      type: "tool_result",
      tool_use_id: "t1",
      content: [null],
    } as unknown as ContentBlock;

    expect(() => normalizeContent(blockWithNullElement)).toThrow();
  });

  // -------------------------------------------------------------------------
  // 补充：正常 tool_result（string content）经 normalizeContent 不抛且保留语义
  // （验证 normalizeContent 不误拒合法 content）
  // -------------------------------------------------------------------------
  it("normalizeContent accepts valid string content in tool_result", () => {
    const valid: ContentBlock = toolResultBlock("t1", "result text");
    const normalized = normalizeContent(valid);
    // 归一化后仍是 tool_result，tool_use_id 与 content 保留
    expect(normalized).toEqual(valid);
  });
});
