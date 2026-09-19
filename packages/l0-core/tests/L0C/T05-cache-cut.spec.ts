// L0C-T05 — cache_control exact-prefix 契约 + compaction 切点边界契约
// 测试根：packages/l0-core/tests/L0C/T05-cache-cut.spec.ts
// 导入路径：@harness/l0-core（spec 声明的包名）
//
// 本文件为 RED 阶段产物：模块尚未实现，import 会失败——合法 RED。
// 断言逻辑在实现完成后能真正检验行为。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertStablePrefix,
  findValidCutPoints,
  assertCutNotOrphan,
  assertStablePrefixUntouched,
  onCachePrefixViolation,
  STABLE_PREFIX_UNTOUCHABLE,
  DEFAULT_RESERVE,
  DEFAULT_KEEP_RECENT,
} from "@harness/l0-core";
import type { CutPointEntry, CachePrefixViolationEvent } from "@harness/l0-core";

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

/** 构造 entries 的便捷工厂，保持测试可读。 */
function entries(...types: CutPointEntry["type"][]): CutPointEntry[] {
  return types.map((type) => ({ type }));
}

// ───────────────────────────────────────────────────────────────────────────
// L0C-T05
// ───────────────────────────────────────────────────────────────────────────

describe("L0C-T05", () => {
  // ── 常量契约（接口签名 §2 + 执行提示 ③）─────────────────────────────

  describe("constants", () => {
    it("STABLE_PREFIX_UNTOUCHABLE is true (prefix 不可被 compaction 触碰)", () => {
      expect(STABLE_PREFIX_UNTOUCHABLE).toBe(true);
    });

    it("DEFAULT_RESERVE === 16384 (L1 config 默认值锚点)", () => {
      expect(DEFAULT_RESERVE).toBe(16384);
    });

    it("DEFAULT_KEEP_RECENT === 20000 (L1 config 默认值锚点)", () => {
      expect(DEFAULT_KEEP_RECENT).toBe(20000);
    });
  });

  // ── cache_control exact-prefix 契约 ─────────────────────────────────

  describe("assertStablePrefix — cache prefix exact-prefix 不变量", () => {
    let unsubscribe: (() => void) | undefined;

    beforeEach(() => {
      unsubscribe = undefined;
    });

    afterEach(() => {
      unsubscribe?.();
    });

    it("cache prefix unchanged passes: oldHash === newHash 不 emit violation", () => {
      const handler = vi.fn<
        (event: CachePrefixViolationEvent) => void
      >();
      unsubscribe = onCachePrefixViolation(handler);

      const hash = "a".repeat(64); // sha256 hex 占位
      // 正常路径：prefix 未变 → 通过，不抛、不 emit
      expect(() => assertStablePrefix(hash, hash)).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });

    it("cache prefix change emits violation: oldHash !== newHash → emit CachePrefixViolation 事件（不 throw，10x 成本告警不变量）", () => {
      const handler = vi.fn<
        (event: CachePrefixViolationEvent) => void
      >();
      unsubscribe = onCachePrefixViolation(handler);

      const oldHash = "a".repeat(64);
      const newHash = "b".repeat(64);

      // 边界：合法进化允许改 prefix 但须经 canary，故只 emit 告警不 throw
      expect(() => assertStablePrefix(oldHash, newHash)).not.toThrow();

      // 断言事件确实被 emit，且携带 oldHash/newHash 供 telemetry 消费
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]![0];
      expect(event).toMatchObject({
        type: "CachePrefixViolation",
        oldHash,
        newHash,
      });
    });

    it("cache prefix violation handler 可取消订阅（unsubscribe 后不再收到事件）", () => {
      const handler = vi.fn<
        (event: CachePrefixViolationEvent) => void
      >();
      unsubscribe = onCachePrefixViolation(handler);
      assertStablePrefix("a".repeat(64), "b".repeat(64));
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe!();
      unsubscribe = undefined; // 避免 afterEach 二次调用

      // 取消订阅后再次触发 → handler 不应被调用
      assertStablePrefix("a".repeat(64), "c".repeat(64));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── compaction 切点边界契约 ───────────────────────────────────────

  describe("findValidCutPoints — 切点必须落在 user/assistant 消息边界", () => {
    it("valid cut points exclude tool_result: [user, assistant(tool_use), tool_result, user] → [0,1,3]", () => {
      // GWT #3：assistant with tool_use 时其 tool_result 跟随后被保留，
      // 故 tool_result index 2 不可作切点，assistant index 1 可切。
      const e = entries("user", "assistant", "tool_result", "user");
      const result = findValidCutPoints(e, 0, e.length);
      expect(result).toEqual([0, 1, 3]);
      // 实质断言：返回的每个 index 处 entry.type ∈ {user, assistant}
      for (const idx of result) {
        expect(["user", "assistant"]).toContain(e[idx]!.type);
      }
    });

    it("valid cut points exclude compaction entries: compaction entry 不可作切点", () => {
      // spec CutPointEntry.type 含 "compaction"；compaction 不是消息边界。
      const e = entries(
        "user",
        "assistant",
        "compaction",
        "user",
        "assistant",
      );
      const result = findValidCutPoints(e, 0, e.length);
      expect(result).toEqual([0, 1, 3, 4]);
      for (const idx of result) {
        expect(["user", "assistant"]).toContain(e[idx]!.type);
      }
    });

    it("findValidCutPoints respects [start, end) slice: 只返回该范围内的合法切点", () => {
      const e = entries(
        "user",
        "assistant",
        "tool_result",
        "user",
        "assistant",
      );
      // 限定范围 [1, 4)：候选合法 index 为 1, 3（2 是 tool_result 被排除）
      const result = findValidCutPoints(e, 1, 4);
      expect(result).toEqual([1, 3]);
    });
  });

  describe("assertCutNotOrphan — 切点不得产生孤儿 tool_result", () => {
    it("cut at tool_result throws orphan: 切点落在 tool_result 处 → throw", () => {
      // GWT #4：在 tool_result index 2 处 cut → 孤儿 tool_result（其前导
      // assistant 的 tool_use 失去 tool_result 配对）→ throw。
      const e = entries("user", "assistant", "tool_result", "user");
      expect(() => assertCutNotOrphan(e, 2)).toThrow();
    });

    it("cut at user/assistant boundary does not throw: 合法切点通过", () => {
      const e = entries("user", "assistant", "tool_result", "user");
      // index 0 (user)、index 1 (assistant)、index 3 (user) 均为合法切点
      expect(() => assertCutNotOrphan(e, 0)).not.toThrow();
      expect(() => assertCutNotOrphan(e, 1)).not.toThrow();
      expect(() => assertCutNotOrphan(e, 3)).not.toThrow();
    });

    it("cut at compaction entry throws: compaction 不是合法切点", () => {
      const e = entries("user", "assistant", "compaction", "user");
      expect(() => assertCutNotOrphan(e, 2)).toThrow();
    });
  });

  // ── stable prefix 不可触碰 ─────────────────────────────────────────

  describe("assertStablePrefixUntouched — compaction 切点不得落在 stable prefix 区域", () => {
    it("cut inside stable prefix throws: cutIndex < prefixLen → throw", () => {
      // GWT #5：compaction 切点落在 stable prefix 区域（index < prefixLen）
      // → 违反 prefix 不可触不变量 → throw。
      expect(() => assertStablePrefixUntouched(1, 3)).toThrow();
      expect(() => assertStablePrefixUntouched(0, 3)).toThrow();
      // 边界：刚好等于 prefixLen（切点恰在 prefix 之后）不 throw
      expect(() => assertStablePrefixUntouched(3, 3)).not.toThrow();
    });

    it("cut after stable prefix passes: cutIndex >= prefixLen → 通过", () => {
      expect(() => assertStablePrefixUntouched(5, 3)).not.toThrow();
      expect(() => assertStablePrefixUntouched(100, 3)).not.toThrow();
    });
  });
});
