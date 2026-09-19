import { describe, it, expect } from "vitest";
import { evaluateStop, applyMaxTurnsHandler } from "@harness/l0-core";
import type { StopContext } from "@harness/l0-core";

/**
 * L0C-T03 — 停止条件分层骨架 + max_turns_handler 合成契约
 *
 * Spec: execution/L0-core/TASKS.md §L0C-T03
 * SUT: packages/l0-core/src/stop/stop-conditions.ts
 *
 * 优先级（spec GREEN）: end_turn → abort → unrecoverable_error → max_turns
 */

/** 构造一个可覆盖的 StopContext，默认处于"无停止条件命中"基线。 */
function makeCtx(overrides: Partial<StopContext> = {}): StopContext {
  const ac = new AbortController();
  return {
    stopReason: "tool_use",
    turnIndex: 0,
    maxTurns: 10,
    abortSignal: ac.signal,
    retryExhausted: false,
    ...overrides,
  };
}

describe("L0C-T03", () => {
  describe("evaluateStop — 四层停止检测", () => {
    it("end_turn layer triggers on end_turn stop reason", () => {
      // Given stopReason==='end_turn' 且无 tool_use；When evaluateStop；
      // Then {stop:true, layer:"end_turn"}（正常路径）
      const ctx = makeCtx({
        stopReason: "end_turn",
        turnIndex: 0,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("end_turn");
      // reason 必须承载语义信息（非空字符串），非空壳字段
      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(0);
    });

    it("max_turns layer triggers when turnIndex reaches maxTurns (boundary: equal)", () => {
      // Given turnIndex >= maxTurns；When evaluateStop；
      // Then {stop:true, layer:"max_turns"}（边界：等号命中）
      const ctx = makeCtx({
        stopReason: "tool_use",
        turnIndex: 10,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("max_turns");
    });

    it("max_turns layer triggers when turnIndex exceeds maxTurns", () => {
      const ctx = makeCtx({
        stopReason: "tool_use",
        turnIndex: 11,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("max_turns");
    });

    it("unrecoverable_error layer triggers on retryExhausted + error", () => {
      // Given retryExhausted===true 且不可重试 error；When evaluateStop；
      // Then {stop:true, layer:"unrecoverable_error"}（错误路径）
      const ctx = makeCtx({
        stopReason: "error",
        retryExhausted: true,
        turnIndex: 0,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("unrecoverable_error");
    });

    it("abort layer triggers when abortSignal.aborted===true", () => {
      // Given abortSignal.aborted===true；When evaluateStop；
      // Then {stop:true, layer:"abort"}
      const ac = new AbortController();
      ac.abort();
      const ctx = makeCtx({
        stopReason: "tool_use",
        abortSignal: ac.signal,
        turnIndex: 0,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("abort");
    });
  });

  describe("evaluateStop — 优先级判定（spec GREEN: end_turn → abort → unrecoverable_error → max_turns）", () => {
    it("abort takes priority over max_turns", () => {
      // 用户意图（abort）必须早于兜底（max_turns）—— spec 执行提示 ①
      const ac = new AbortController();
      ac.abort();
      const ctx = makeCtx({
        stopReason: "tool_use",
        abortSignal: ac.signal,
        turnIndex: 100,
        maxTurns: 10,
        retryExhausted: false,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("abort");
    });

    it("unrecoverable_error takes priority over max_turns", () => {
      const ctx = makeCtx({
        stopReason: "error",
        retryExhausted: true,
        turnIndex: 100,
        maxTurns: 10,
      });
      const decision = evaluateStop(ctx);

      expect(decision.stop).toBe(true);
      expect(decision.layer).toBe("unrecoverable_error");
    });
  });

  describe("applyMaxTurnsHandler — max_turns_handler 合成契约", () => {
    it("handler accepts valid output and passes it through", () => {
      // 给合法输出 → 透传（结构等价）
      const raw = {
        summary: "completed analysis of module A",
        incomplete: false,
        nextSteps: ["review", "commit"],
      };
      const result = applyMaxTurnsHandler(raw);

      expect(result).toEqual(raw);
      expect(result.incomplete).toBe(false);
      expect(result.nextSteps).toEqual(["review", "commit"]);
      expect(result.summary).toBe("completed analysis of module A");
    });

    it("handler accepts valid output with incomplete=true and empty nextSteps", () => {
      const raw = {
        summary: "partial progress",
        incomplete: true,
        nextSteps: [],
      };
      const result = applyMaxTurnsHandler(raw);

      expect(result).toEqual(raw);
    });

    it("max_turns handler falls back on invalid schema (missing incomplete field)", () => {
      // Given handler 输出缺 `incomplete` 字段（schema 不合法）；
      // When applyMaxTurnsHandler；Then 回退默认 handler 且 incomplete===true（防硬失败）
      const result = applyMaxTurnsHandler({ summary: "x" });

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
      // 默认 handler 的 summary 必须承载 raw progress（非空字符串），不是空壳
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it("handler falls back on null input", () => {
      const result = applyMaxTurnsHandler(null);

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it("handler falls back when nextSteps is not an array", () => {
      const result = applyMaxTurnsHandler({
        summary: "x",
        incomplete: false,
        nextSteps: "not-an-array",
      });

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
    });

    it("handler falls back when summary is missing", () => {
      const result = applyMaxTurnsHandler({
        incomplete: false,
        nextSteps: ["a"],
      });

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
    });

    it("handler falls back when summary is not a string", () => {
      const result = applyMaxTurnsHandler({
        summary: 42,
        incomplete: false,
        nextSteps: ["a"],
      });

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
    });

    it("handler falls back when incomplete is not a boolean", () => {
      const result = applyMaxTurnsHandler({
        summary: "x",
        incomplete: "yes",
        nextSteps: ["a"],
      });

      expect(result.incomplete).toBe(true);
      expect(result.nextSteps).toEqual([]);
    });
  });
});
