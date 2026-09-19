// L0C-T09b · 不变量测试集 B
//
// Spec: execution/L0-core/TASKS.md §L0C-T09b (ERRATA-amended).
//
// 覆盖五条不变量（每个一个 describe）：
//   (1) never-auto-delete（archive 非 delete）—— assertArchiveNotDeleted(archivePath)
//   (2) C>0 下限（Ratchet bounded cap）—— assertCBound(C)
//   (3) authoring prior 存在 + 不可退役 —— assertAuthoringPriorExists(library)
//   (4) unsent_tool_call_ids 跟踪（序列化/反序列化不丢失）—— T07a round-trip
//   (5) 切点=消息边界 —— findValidCutPoints 只返回 user/assistant 索引
//
// 归属（spec §T09b）：never-auto-delete / C>0 / authoring prior 的最小 curator
// 逻辑由 L2-T10 实现；本任务只测 **L0C 导出的守卫函数**（assertCBound /
// assertAuthoringPriorExists / assertArchiveNotDeleted），curator 实现在 L2。
//
// RED state：守卫函数 assertCBound / assertAuthoringPriorExists /
// assertArchiveNotDeleted 尚未由 L0C 导出（属本任务 GREEN 的交付物）→
// import 会失败，这是合法 RED。T07a（unsent 跟踪）与 T05（切点）已实现，
// 对应 describe 期望全绿。突变注入由 scripts/mutate-invariant.sh + verify.sh
// L0C-T09b 分支负责，不在本文件内联。
//
// 断言逻辑在实现完成后能真正检验行为。

import { describe, it, expect } from "vitest";
import {
  assertCBound,
  assertAuthoringPriorExists,
  assertArchiveNotDeleted,
  AUTHORING_PRIOR_ID,
  serializeRunState,
  deserializeRunState,
  findValidCutPoints,
} from "@harness/l0-core";
import type { RunState, CutPointEntry } from "@harness/l0-core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function baseRunState(): RunState {
  return {
    version: "1.0",
    current_agent: "agent-a",
    _current_turn: 2,
    pending_input: null,
    unsent_tool_call_ids_for_interrupted_state: ["t1"],
    approvals: {},
    turnItems: [],
  };
}

// ===========================================================================
// 不变量 (1): never-auto-delete（archive 非 delete）
// ===========================================================================

describe("L0C-T09b", () => {
  describe("never-auto-delete（archive 非 delete）", () => {
    // 前置：守卫函数必须已由 L0C 导出（避免 RED 态下 undefined 调用产生
    // 假阳性 throw）。实现完成后此断言为真。
    it("assertArchiveNotDeleted 已由 L0C 导出", () => {
      expect(typeof assertArchiveNotDeleted).toBe("function");
    });

    it("archive 路径存在 → assertArchiveNotDeleted 通过（保留即恢复可能）", () => {
      expect(typeof assertArchiveNotDeleted).toBe("function");
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "l0c-t09b-archive-"),
      );
      const archivePath = path.join(dir, "retired-skill.md");
      fs.writeFileSync(archivePath, "retired content", "utf8");
      expect(() => assertArchiveNotDeleted(archivePath)).not.toThrow();
    });

    it("archive 路径被物理删除 → assertArchiveNotDeleted throw（不可逆）", () => {
      expect(typeof assertArchiveNotDeleted).toBe("function");
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "l0c-t09b-archive-"),
      );
      const archivePath = path.join(dir, "missing.md");
      // 不创建 → 不存在
      expect(() => assertArchiveNotDeleted(archivePath)).toThrow(
        /\barchive\b|\bdelet|\bnot.*exist|\bmissing/i,
      );
    });
  });

  // ===========================================================================
  // 不变量 (2): C>0 下限（Ratchet bounded cap）
  // ===========================================================================

  describe("C>0 下限（Ratchet bounded cap）", () => {
    it("assertCBound 已由 L0C 导出", () => {
      expect(typeof assertCBound).toBe("function");
    });

    it("C=50 → assertCBound 通过（有界容量）", () => {
      expect(typeof assertCBound).toBe("function");
      expect(() => assertCBound(50)).not.toThrow();
    });

    it("C=1 → assertCBound 通过（下限边界）", () => {
      expect(typeof assertCBound).toBe("function");
      expect(() => assertCBound(1)).not.toThrow();
    });

    it("C=0 → assertCBound throw（关掉有界容量 = 库崩塌）", () => {
      expect(typeof assertCBound).toBe("function");
      expect(() => assertCBound(0)).toThrow(/\bbound|\bC\b|zero|positive|cap/i);
    });

    it("C=-5 → assertCBound throw（负值非法）", () => {
      expect(typeof assertCBound).toBe("function");
      expect(() => assertCBound(-5)).toThrow(/\bbound|\bC\b|negative|positive|cap/i);
    });
  });

  // ===========================================================================
  // 不变量 (3): authoring prior 存在 + 不可退役
  // ===========================================================================

  describe("authoring prior 存在 + 不可退役", () => {
    it("assertAuthoringPriorExists 已由 L0C 导出", () => {
      expect(typeof assertAuthoringPriorExists).toBe("function");
    });

    it("library 含 authoring prior 且不可退役 → assertAuthoringPriorExists 通过", () => {
      expect(typeof assertAuthoringPriorExists).toBe("function");
      const library = {
        skills: [
          { name: "some-skill", retireable: true },
          { name: AUTHORING_PRIOR_ID, retireable: false },
        ],
      };
      expect(() => assertAuthoringPriorExists(library)).not.toThrow();
    });

    it("library 不含 authoring prior → throw（移除损 43% gain）", () => {
      expect(typeof assertAuthoringPriorExists).toBe("function");
      const library = {
        skills: [{ name: "other-skill", retireable: true }],
      };
      expect(() => assertAuthoringPriorExists(library)).toThrow(
        /\bauthoring|\bprior|\bmissing|\bnot.*exist/i,
      );
    });

    it("authoring prior 被标记为 retireable=true → throw（不可退役）", () => {
      expect(typeof assertAuthoringPriorExists).toBe("function");
      const library = {
        skills: [
          { name: AUTHORING_PRIOR_ID, retireable: true },
        ],
      };
      expect(() => assertAuthoringPriorExists(library)).toThrow(
        /\bretire|\bauthoring|\bprior/i,
      );
    });
  });

  // ===========================================================================
  // 不变量 (4): unsent_tool_call_ids 跟踪（序列化/反序列化不丢失）
  // ===========================================================================

  describe("unsent_tool_call_ids 跟踪（与 T07a 互补）", () => {
    it("round-trip 不丢失 unsent_tool_call_ids（中断恢复跟踪字段）", () => {
      const state = baseRunState();
      const json = serializeRunState(state);
      const restored = deserializeRunState(json);
      expect(restored.unsent_tool_call_ids_for_interrupted_state).toEqual(
        ["t1"],
      );
    });

    it("空 unsent_tool_call_ids 也能 round-trip（无未回填时不丢失空集）", () => {
      const state = baseRunState();
      state.unsent_tool_call_ids_for_interrupted_state = [];
      const restored = deserializeRunState(serializeRunState(state));
      expect(restored.unsent_tool_call_ids_for_interrupted_state).toEqual([]);
    });

    it("多元素 unsent_tool_call_ids round-trip 保序", () => {
      const state = baseRunState();
      state.unsent_tool_call_ids_for_interrupted_state = ["a", "b", "c"];
      const restored = deserializeRunState(serializeRunState(state));
      expect(restored.unsent_tool_call_ids_for_interrupted_state).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });

  // ===========================================================================
  // 不变量 (5): 切点=消息边界
  // ===========================================================================

  describe("切点=消息边界（findValidCutPoints 只返回 user/assistant）", () => {
    function makeEntries(n: number): CutPointEntry[] {
      const entries: CutPointEntry[] = [];
      // 确定性构造混合序列：user, assistant(tool_use), tool_result, user 循环
      const cycle: CutPointEntry["type"][] = [
        "user",
        "assistant",
        "tool_result",
        "user",
      ];
      for (let i = 0; i < n; i++) {
        entries.push({ type: cycle[i % cycle.length]! });
      }
      return entries;
    }

    it("100 条随机 entries → 所有返回 index 处 type ∈ {user, assistant}", () => {
      const entries = makeEntries(100);
      const cuts = findValidCutPoints(entries, 0, entries.length);
      expect(cuts.length).toBeGreaterThan(0);
      for (const idx of cuts) {
        const e = entries[idx]!;
        expect(e.type === "user" || e.type === "assistant").toBe(true);
        // 不含 tool_result / compaction
        expect(e.type).not.toBe("tool_result");
        expect(e.type).not.toBe("compaction");
      }
    });

    it("切点不含 tool_result（防孤儿 tool_result）", () => {
      const entries: CutPointEntry[] = [
        { type: "user" },
        { type: "assistant" },
        { type: "tool_result" },
        { type: "user" },
      ];
      const cuts = findValidCutPoints(entries, 0, entries.length);
      expect(cuts).toEqual([0, 1, 3]);
      for (const idx of cuts) {
        expect(entries[idx]!.type).not.toBe("tool_result");
      }
    });

    it("compaction 条目永不可为切点", () => {
      const entries: CutPointEntry[] = [
        { type: "user" },
        { type: "compaction" },
        { type: "assistant" },
        { type: "compaction" },
        { type: "user" },
      ];
      const cuts = findValidCutPoints(entries, 0, entries.length);
      expect(cuts).toEqual([0, 2, 4]);
      for (const idx of cuts) {
        expect(entries[idx]!.type).not.toBe("compaction");
      }
    });
  });
});
