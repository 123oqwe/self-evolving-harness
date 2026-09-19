// L1-T10 · per-tool maxLines/maxBytes + timeout 进化（下限锁；错误类禁 head；破坏性工具人审）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T10 spec 编写。

import { describe, it, expect } from "vitest";
import {
  ToolTruncationTimeout,
  LIMITS,
  DESTRUCTIVE_TOOLS,
  type TruncationConfig,
  type TimeoutConfig,
  type TruncationSignal,
} from "@harness/l1-config";

function trunc(o: Partial<TruncationConfig>): TruncationConfig {
  return { tool: o.tool ?? "read", maxLines: o.maxLines ?? 2000, maxBytes: o.maxBytes ?? 50000, headTail: o.headTail ?? "tail" };
}
function timeout(o: Partial<TimeoutConfig>): TimeoutConfig {
  return { tool: o.tool ?? "read", timeoutMs: o.timeoutMs ?? 30000 };
}

describe("L1-T10", () => {
  it("evolve enlarges maxBytes for high-reread tool", () => {
    const e = new ToolTruncationTimeout();
    const truncs: TruncationConfig[] = [trunc({ tool: "read", maxBytes: 50000 })];
    const timeouts: TimeoutConfig[] = [timeout({ tool: "read" })];
    const signals: TruncationSignal[] = [
      { tool: "read", rereadRate: 0.8, taskSuccess: true, perTurnTokens: 1000, p99Drift: 0 } as TruncationSignal,
    ];
    const result = e.evolve(truncs, timeouts, signals);
    const readTrunc = result.trunc.find((t) => t.tool === "read")!;
    expect(readTrunc.maxBytes).toBeGreaterThan(50000);
  });

  it("assertLimits throws when maxBytes < 1KB", () => {
    const e = new ToolTruncationTimeout();
    expect(LIMITS.maxBytesFloor).toBe(1024);
    expect(() => e.assertLimits(trunc({ maxBytes: 512 }))).toThrow();
  });

  it("assertLimits throws when timeout < 1s", () => {
    const e = new ToolTruncationTimeout();
    expect(LIMITS.timeoutMsFloor).toBe(1000);
    expect(() => e.assertLimits(timeout({ timeoutMs: 500 }))).toThrow();
  });

  it("assertErrorOutputNotHead throws on error class + head", () => {
    const e = new ToolTruncationTimeout();
    const c = trunc({ headTail: "head" });
    expect(() => e.assertErrorOutputNotHead(c, true)).toThrow();
    // tail 不 throw
    expect(() => e.assertErrorOutputNotHead(trunc({ headTail: "tail" }), true)).not.toThrow();
    // head 但非错误类不 throw
    expect(() => e.assertErrorOutputNotHead(c, false)).not.toThrow();
  });

  it("assertDestructiveHumanGated throws on bash auto-evolved", () => {
    const e = new ToolTruncationTimeout();
    expect(DESTRUCTIVE_TOOLS).toContain("bash");
    expect(() => e.assertDestructiveHumanGated("bash", true)).toThrow();
    // 人审通过（isAutoEvolved=false）不 throw
    expect(() => e.assertDestructiveHumanGated("bash", false)).not.toThrow();
    // 非破坏性工具自主进化不 throw
    expect(() => e.assertDestructiveHumanGated("read", true)).not.toThrow();
  });

  it("Pareto: token↓ + success持平 + reread↓ → 入选", () => {
    const e = new ToolTruncationTimeout();
    const truncs: TruncationConfig[] = [trunc({ tool: "read", maxBytes: 50000 })];
    const timeouts: TimeoutConfig[] = [timeout({ tool: "read" })];
    const signals: TruncationSignal[] = [
      { tool: "read", rereadRate: 0.2, taskSuccess: true, perTurnTokens: 800, p99Drift: 0 } as TruncationSignal,
    ];
    const result = e.evolve(truncs, timeouts, signals);
    const readTrunc = result.trunc.find((t) => t.tool === "read")!;
    expect(readTrunc.maxBytes).toBeGreaterThanOrEqual(LIMITS.maxBytesFloor);
  });
});
