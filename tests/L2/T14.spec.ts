// L2-T14: 写路径路由表 + 触发阈值 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T14）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  route,
  shouldTriggerBackground,
  runBackgroundJob,
  hotPathWithFallback,
} from "@harness/l2-memory";
import type { RouteTable, TriggerThreshold, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

describe("L2-T14", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t14-"));
  });

  it("route feedback to hot", () => {
    const table: RouteTable = { feedback: "hot", episodic: "background" };
    expect(route("feedback", table)).toBe("hot");
  });

  it("route episodic to background", () => {
    const table: RouteTable = { feedback: "hot", episodic: "background" };
    expect(route("episodic", table)).toBe("background");
  });

  it("shouldTriggerBackground on eventCount", () => {
    const threshold: TriggerThreshold = {
      intervalMs: 60_000,
      eventCount: 10,
      contextPressure: 0.9,
    };
    expect(
      shouldTriggerBackground(threshold, {
        lastRun: Date.now(),
        pendingEvents: 10,
        pressure: 0,
      }),
    ).toBe(true);
    expect(
      shouldTriggerBackground(threshold, {
        lastRun: Date.now(),
        pendingEvents: 5,
        pressure: 0,
      }),
    ).toBe(false);
  });

  it("background job idempotent on same key", () => {
    const c = ctx(baseDir);
    // runBackgroundJob 返回是否新处理了条目（true=新处理，false=同 key 跳过）。
    // 重跑同 key 不产生重复条目——第二次须返回 false（idempotent skip）。
    const first = runBackgroundJob("key1", c);
    expect(first).toBe(true);
    const second = runBackgroundJob("key1", c);
    expect(second).toBe(false);
    // 不同 key 仍可处理
    const other = runBackgroundJob("key2", c);
    expect(other).toBe(true);
  });

  it("hot-path failure falls back to background", () => {
    const c = ctx(baseDir) as unknown as MemCtx & {
      hotWriteFails?: boolean;
    };
    // hot-path 写成功 → 走 hot
    (c as Record<string, unknown>).hotWriteFails = false;
    const okRes = hotPathWithFallback(
      { type: "feedback", content: "note" },
      c,
    );
    expect(okRes).toBe("hot");
    // hot-path 写失败 → fallback 到 background 队列，不丢 memory
    (c as Record<string, unknown>).hotWriteFails = true;
    const res = hotPathWithFallback(
      { type: "feedback", content: "note2" },
      c,
    );
    expect(res).toBe("background");
  });
});
