// L0C-T09a · 不变量测试集 A
//
// Spec: execution/L0-core/TASKS.md §L0C-T09a (ERRATA-amended).
//
// 跨任务不变量断言，把 T02 的单点校验提升为系统级守卫。覆盖两条：
//   (1) turn 边界 —— 在任意非 turn_end 点插入 context-only 消息被状态机拒绝
//        （isLegalInsertionPoint("mid_turn")===false，flush 抛）。
//   (2) 孤儿 tool_result 400 —— 20 条随机 transcript（含故意制造的孤儿），
//        assertToolUsePaired 对孤儿 throw OrphanToolResultError statusCode=400，
//        对合法案例通过（双例都覆盖）。
//
// 归属说明（spec 防结构性 gap）：原 PRD/WBS 列出的 silence≠approval 与
// scope broad→narrow 两条安全不变量已按归属层移出 L0C（前者归 L0S hook/
// permission 任务，后者归 L2 agent-files scope auto-load 任务）。本文件不测、
// 不导出那两条守卫。
//
// RED state（spec T09a RED 注）：底层 T02 已实现 → 本文件期望全绿。突变注入
// （scripts/mutate-invariant.sh + verify.sh L0C-T09a 分支）负责把对应 it 变红，
// 不在本 spec 文件内联。本文件只测 L0C 已导出的 T02 契约，不新增 L0C 源码。
//
// 断言逻辑在实现完成后（及突变注入后）能真正检验行为：测行为不测实现。

import { describe, it, expect } from "vitest";
import {
  assertToolUsePaired,
  createTurnStateMachine,
  OrphanToolResultError,
} from "@harness/l0-core";
import type {
  ContentBlock,
  AssistantMessage,
  ToolResult,
} from "@harness/l0-core";

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function assistantWithToolUse(id: string, name = "tool"): AssistantMessage {
  const block: ContentBlock = { type: "tool_use", id, name, input: {} };
  return { content: [block] } as unknown as AssistantMessage;
}

function assistantText(text: string): AssistantMessage {
  const block: ContentBlock = { type: "text", text };
  return { content: [block] } as unknown as AssistantMessage;
}

function toolResult(toolUseId: string): ToolResult {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: "ok",
  } as unknown as ToolResult;
}

/** 构造一条合法的配对 transcript：assistant(tool_use t1) → tool_result(t1)。 */
function pairedTranscript(id: string): ContentBlock[] {
  return [
    { type: "tool_use", id, name: "tool", input: {} },
    { type: "tool_result", tool_use_id: id, content: "ok" },
  ];
}

/** 构造一条孤儿 transcript：tool_result(t1) 但无对应 tool_use。 */
function orphanTranscript(id: string): ContentBlock[] {
  return [{ type: "tool_result", tool_use_id: id, content: "ok" }];
}

// ---------------------------------------------------------------------------
// 确定性 PRNG（mulberry32）—— spec 要求 generateTranscripts(seed, count) fixture 生成器
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedTranscript {
  readonly id: string;
  readonly blocks: ContentBlock[];
  /** true = 期望 assertToolUsePaired 通过；false = 期望 throw 400。 */
  readonly expectThrow: boolean;
}

/**
 * 生成 `count` 条 transcript：一半合法（配对），一半孤儿（无 tool_use 的
 * tool_result）。id 唯一以便断言定位。确定性：同 seed 产同序列。
 */
function generateTranscripts(seed: number, count: number): GeneratedTranscript[] {
  const rng = mulberry32(seed);
  const out: GeneratedTranscript[] = [];
  for (let i = 0; i < count; i++) {
    const id = `t-${seed}-${i}`;
    const makeOrphan = rng() < 0.5; // ~一半孤儿
    if (makeOrphan) {
      out.push({ id, blocks: orphanTranscript(id), expectThrow: true });
    } else {
      out.push({ id, blocks: pairedTranscript(id), expectThrow: false });
    }
  }
  return out;
}

// ===========================================================================
// 不变量 (1): turn 边界
// ===========================================================================

describe("L0C-T09a", () => {
  describe("turn 边界（context-only 消息唯一合法插入点 = turn_end）", () => {
    it("mid_turn 插入点被拒：assistant 含 tool_use 且 tool_result 未到达 → isLegalInsertionPoint('mid_turn')===false", () => {
      const assistant = assistantWithToolUse("t1");
      const machine = createTurnStateMachine(assistant, []); // 无 tool_result → mid_turn
      expect(machine.isLegalInsertionPoint("mid_turn")).toBe(false);
    });

    it("mid_turn flush 被拒（防孤儿 tool_use_id）", () => {
      const assistant = assistantWithToolUse("t1");
      const machine = createTurnStateMachine(assistant, []);
      expect(() => machine.flushPending()).toThrow();
    });

    it("turn_end 插入点合法：全部 tool_result 已到达 → isLegalInsertionPoint('turn_end')===true", () => {
      const assistant = assistantWithToolUse("t1");
      const machine = createTurnStateMachine(assistant, [toolResult("t1")]);
      expect(machine.isLegalInsertionPoint("turn_end")).toBe(true);
    });

    it("turn_end flush 成功（destructive 清空，不抛）", () => {
      const assistant = assistantWithToolUse("t1");
      const machine = createTurnStateMachine(assistant, [toolResult("t1")]);
      expect(() => machine.flushPending()).not.toThrow();
    });

    it("纯文本 assistant（无 tool_use）= turn_end：合法插入点", () => {
      const assistant = assistantText("final answer");
      const machine = createTurnStateMachine(assistant, []);
      expect(machine.isLegalInsertionPoint("turn_end")).toBe(true);
      expect(machine.isLegalInsertionPoint("mid_turn")).toBe(false);
    });

    it("完整 transcript 中任一非 turn_end 点插入均被拒（端到端不变量）", () => {
      // 一个含两轮的 transcript：第一轮 t1 已配对（turn_end），第二轮 t2 tool_result
      // 尚未到达（mid_turn）。整体看，当前 active turn 处于 mid_turn → 拒绝插入。
      const second = assistantWithToolUse("t2");
      const machine = createTurnStateMachine(second, []);
      expect(machine.isLegalInsertionPoint("mid_turn")).toBe(false);
      expect(machine.isLegalInsertionPoint("turn_end")).toBe(false);
      expect(() => machine.flushPending()).toThrow();
    });
  });

  // ===========================================================================
  // 不变量 (2): 孤儿 tool_result 400
  // ===========================================================================

  describe("孤儿 tool_result 400（assertToolUsePaired 双例覆盖）", () => {
    const cases = generateTranscripts(42, 20);

    for (const c of cases) {
      it(`transcript ${c.id} — ${c.expectThrow ? "孤儿 → throw OrphanToolResultError(400)" : "合法 → 通过"}`, () => {
        if (c.expectThrow) {
          // 错误路径：孤儿 tool_result → throw OrphanToolResultError statusCode=400
          let caught: unknown;
          try {
            assertToolUsePaired(c.blocks);
            caught = undefined;
            // 不应到达此处
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(OrphanToolResultError);
          const err = caught as OrphanToolResultError;
          expect(err.statusCode).toBe(400);
        } else {
          // 正常路径：合法配对 → 不 throw
          expect(() => assertToolUsePaired(c.blocks)).not.toThrow();
        }
      });
    }

    it("双例都覆盖：20 条中既有孤儿又有合法（fixture 完备性）", () => {
      const hasThrow = cases.some((c) => c.expectThrow);
      const hasPass = cases.some((c) => !c.expectThrow);
      expect(hasThrow).toBe(true);
      expect(hasPass).toBe(true);
    });

    it("重复 tool_use id 视为 mismatch → throw 400", () => {
      const blocks: ContentBlock[] = [
        { type: "tool_use", id: "dup", name: "tool", input: {} },
        { type: "tool_use", id: "dup", name: "tool", input: {} },
        { type: "tool_result", tool_use_id: "dup", content: "ok" },
      ];
      let caught: unknown;
      try {
        assertToolUsePaired(blocks);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OrphanToolResultError);
      expect((caught as OrphanToolResultError).statusCode).toBe(400);
    });

    it("重复 tool_result 同 id 视为 mismatch → throw 400", () => {
      const blocks: ContentBlock[] = [
        { type: "tool_use", id: "x", name: "tool", input: {} },
        { type: "tool_result", tool_use_id: "x", content: "ok" },
        { type: "tool_result", tool_use_id: "x", content: "dup" },
      ];
      let caught: unknown;
      try {
        assertToolUsePaired(blocks);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OrphanToolResultError);
      expect((caught as OrphanToolResultError).statusCode).toBe(400);
    });
  });
});
