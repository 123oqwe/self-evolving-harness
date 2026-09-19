import { describe, it, expect } from "vitest";
import {
  RUN_STATE_VERSION,
  serializeRunState,
  deserializeRunState,
  markTerminalAfterPersist,
  assertNoResentToolCalls,
  type RunState,
  type TurnItem,
} from "@harness/l0-core";

/**
 * L0C-T07a — RunState schema + turn items 持久化先于 terminal 标记
 *
 * Spec: execution/L0-core/TASKS.md §L0C-T07a
 * 行为契约（Given/When/Then）逐条对应下方测试。
 *
 * 注：T07a 行为规范第 1 条原文写 "序列化 → 反序列化 → wake"，但 T07a 的
 * 接口签名节只导出 serializeRunState / deserializeRunState，wake 属 T07b
 * session log 契约。本文件按 T07a 导出契约用 serialize→deserialize 做
 * round-trip（见 ambiguities 字段）。
 */

/** 构造一个合法的 RunState（全部 schema 必填字段）。 */
function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    current_agent: "agent-A",
    _current_turn: 3,
    pending_input: null,
    unsent_tool_call_ids_for_interrupted_state: [],
    approvals: {},
    turnItems: [],
    ...overrides,
  } as RunState;
}

/** 构造一个 turnItem。 */
function makeTurnItem(
  toolUseId: string,
  opts: Partial<TurnItem> = {}
): TurnItem {
  return {
    toolUseId,
    persisted: false,
    terminal: false,
    ...opts,
  } as TurnItem;
}

describe("L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记", () => {
  describe("round-trips unsent_tool_call_ids", () => {
    it("round-trips unsent_tool_call_ids through serialize/deserialize", () => {
      // Given 一个 RunState 含一个 unsent_tool_call_ids=["t1"]（中断时未回填）
      const original = makeState({
        unsent_tool_call_ids_for_interrupted_state: ["t1"],
        current_agent: "agent-B",
        _current_turn: 7,
        pending_input: { kind: "interrupt", reason: "HITL" },
        approvals: { "approval-1": "pending" },
        turnItems: [makeTurnItem("t1", { persisted: false, terminal: false })],
      });

      // When 序列化 → 反序列化
      const json = serializeRunState(original);
      expect(typeof json).toBe("string");
      // JSON 顶层必须是对象且带正确 version
      const parsed = JSON.parse(json) as { version: string };
      expect(parsed.version).toBe(RUN_STATE_VERSION);

      const rehydrated = deserializeRunState(json);

      // Then unsent_tool_call_ids 等价（正常路径，字段在序列化/反序列化中不丢失）
      expect(rehydrated.unsent_tool_call_ids_for_interrupted_state).toEqual([
        "t1",
      ]);
      // 其余字段也等价
      expect(rehydrated.current_agent).toBe("agent-B");
      expect(rehydrated._current_turn).toBe(7);
      expect(rehydrated.pending_input).toEqual({ kind: "interrupt", reason: "HITL" });
      expect(rehydrated.approvals).toEqual({ "approval-1": "pending" });
      expect(rehydrated.turnItems).toEqual([
        makeTurnItem("t1", { persisted: false, terminal: false }),
      ]);
    });
  });

  describe("terminal requires persisted first", () => {
    it("markTerminalAfterPersist throws when persisted=false (must persist first)", () => {
      // Given turnItem t1 persisted=false
      const state = makeState({
        turnItems: [makeTurnItem("t1", { persisted: false, terminal: false })],
      });

      // When markTerminalAfterPersist(state, "t1")
      // Then throw（边界：必须先持久化再标记 terminal）
      expect(() => markTerminalAfterPersist(state, "t1")).toThrowError(
        /persist/i
      );
      // 顺序不可颠倒：抛出后该 item 仍不应被标记为 terminal
      const item = state.turnItems!.find((t) => t.toolUseId === "t1")!;
      expect(item.terminal).toBe(false);
    });

    it("markTerminalAfterPersist marks terminal=true only after persisted=true", () => {
      // 正常路径：已持久化的 item 才允许被标记 terminal
      const state = makeState({
        turnItems: [makeTurnItem("t1", { persisted: true, terminal: false })],
      });

      // When 已 persisted=true → 标记 terminal
      expect(() => markTerminalAfterPersist(state, "t1")).not.toThrow();

      // Then terminal 变为 true（persisted 先于 terminal 的正向确认）
      const item = state.turnItems!.find((t) => t.toolUseId === "t1")!;
      expect(item.persisted).toBe(true);
      expect(item.terminal).toBe(true);
    });

    it("markTerminalAfterPersist throws on unknown toolUseId", () => {
      const state = makeState({
        turnItems: [makeTurnItem("t1", { persisted: true, terminal: false })],
      });
      // 不存在的 tool_use_id 不应被静默接受
      expect(() => markTerminalAfterPersist(state, "does-not-exist")).toThrow();
    });
  });

  describe("resume does not resend terminal tool calls", () => {
    it("assertNoResentToolCalls throws when a terminal tool_use is in the executed set (hard constraint)", () => {
      // Given t1 已 terminal=true（已持久化并标记为终态）
      const state = makeState({
        turnItems: [makeTurnItem("t1", { persisted: true, terminal: true })],
      });

      // When resume 后 mock 工具再次执行 t1 → executed 集合含 "t1"
      const executedToolUseIds = new Set<string>(["t1"]);

      // Then throw（错误路径：重复副作用，hard constraint）
      expect(() =>
        assertNoResentToolCalls(state, executedToolUseIds)
      ).toThrowError(/resent|resend|terminal|already/i);
    });

    it("assertNoResentToolCalls passes when terminal tool calls are NOT re-executed (execution count = 0)", () => {
      // Given t1 已 terminal=true
      const state = makeState({
        turnItems: [
          makeTurnItem("t1", { persisted: true, terminal: true }),
          makeTurnItem("t2", { persisted: true, terminal: true }),
        ],
      });

      // When resume 后 mock 工具不重执行任何 terminal tool call → executed 集合为空
      const executedToolUseIds = new Set<string>([]); // 执行计数 = 0

      // Then 不抛（正常路径：无重复副作用）
      expect(() =>
        assertNoResentToolCalls(state, executedToolUseIds)
      ).not.toThrow();
    });

    it("resume keeps execution count of terminal tool calls at 0 (hard constraint invariant)", () => {
      // 综合断言：terminal 工具在 resume 后执行计数必须为 0；
      // guard 对任何非零重执行必须报错。
      const state = makeState({
        turnItems: [
          makeTurnItem("t1", { persisted: true, terminal: true }),
          makeTurnItem("t2", { persisted: true, terminal: false }),
        ],
      });

      // 正常 resume：t2 非 terminal 可重跑，t1 terminal 不可重跑
      expect(() =>
        assertNoResentToolCalls(state, new Set<string>(["t2"]))
      ).not.toThrow();

      // t1 若被重跑 → 立即触发 hard constraint
      expect(() =>
        assertNoResentToolCalls(state, new Set<string>(["t1", "t2"]))
      ).toThrow();
    });
  });

  describe("rejects version mismatch", () => {
    it("deserializeRunState throws when version does not match (schema drift guard)", () => {
      // Given version="2.0" 的 json（未来/伪造 schema）
      const futureState = makeState();
      const jsonV2 = JSON.stringify({
        ...JSON.parse(serializeRunState(futureState)),
        version: "2.0",
      });

      // When deserializeRunState
      // Then throw（version 不匹配，防 schema drift）
      expect(() => deserializeRunState(jsonV2)).toThrowError(/version/i);
    });

    it("deserializeRunState throws on malformed JSON", () => {
      // 非法 JSON 不应被静默吞掉
      expect(() => deserializeRunState("{ not valid json")).toThrow();
    });

    it("deserializeRunState accepts the current version unchanged", () => {
      // 正常路径：当前 version 的合法 json 必须可往返还原
      const original = makeState({
        unsent_tool_call_ids_for_interrupted_state: ["t1", "t2"],
      });
      const round = deserializeRunState(serializeRunState(original));
      expect(round.version).toBe(RUN_STATE_VERSION);
      expect(round.unsent_tool_call_ids_for_interrupted_state).toEqual([
        "t1",
        "t2",
      ]);
    });
  });
});
