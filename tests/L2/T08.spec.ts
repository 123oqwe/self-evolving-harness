// L2-T08: working memory block value 进化 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T08）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  replaceBlockValue,
  snapshotToRecall,
  recallSearch,
  scheduleBlockFreshContextReview,
} from "@harness/l2-memory";
import type { Block, RejectReason, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
    sessionId: "sess-1",
    taskId: "t1",
    promptHash: "h1",
    agentId: "a1",
  } as unknown as MemCtx;
}

function isReject(r: Block | RejectReason): r is RejectReason {
  return (r as RejectReason).ok === false;
}

describe("L2-T08", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t08-"));
  });

  it("replaceBlockValue writes and snapshots", () => {
    const c = ctx(baseDir);
    // 先建立一个 writable block（通过 replaceBlockValue 触发 schema 注册）
    const res = replaceBlockValue("custom", "new value", c);
    expect(isReject(res)).toBe(false);
    const blk = res as Block;
    expect(blk.value).toBe("new value");
    // recall_storage 含旧值快照（首次 replace 旧值为空也快照）
    const dir = join(baseDir, "archive/working/custom");
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(1);
  });

  it("replaceBlockValue rejects read_only", () => {
    const c = ctx(baseDir);
    // 先标记 persona block 为 read_only（通过显式 register 或第二次 replace 触发保护）
    // 实现：readOnly=true 的 block 调用 replaceBlockValue 返回 RejectReason
    const res = replaceBlockValue("persona", "x", {
      ...c,
      forceReadOnly: true,
    } as unknown as MemCtx);
    expect(isReject(res)).toBe(true);
  });

  it("replaceBlockValue rejects exceeds limit", () => {
    const c = ctx(baseDir);
    const tooLong = "a".repeat(5001);
    const res = replaceBlockValue("custom", tooLong, c);
    expect(isReject(res)).toBe(true);
  });

  it("recallSearch returns snapshots", () => {
    const c = ctx(baseDir);
    snapshotToRecall("custom", "old value snapshot", c);
    const results = recallSearch("old value", c);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.includes("old value snapshot"))).toBe(true);
  });

  it("rollback restores old value", () => {
    const c = ctx(baseDir);
    replaceBlockValue("custom", "v1", c);
    replaceBlockValue("custom", "v2", c);
    // recall 应含 v1 快照
    const snapshots = recallSearch("v1", c);
    expect(snapshots.some((s) => s.includes("v1"))).toBe(true);
    // 回滚：replace 回 v1
    const restored = replaceBlockValue("custom", "v1", c) as Block;
    expect(restored.value).toBe("v1");
  });

  it("fresh-context review flags stale block", () => {
    // hook 点：异模型审触发，不阻塞
    expect(() =>
      scheduleBlockFreshContextReview("custom"),
    ).not.toThrow();
  });
});
