// L2-T04b: ExpeL insight 蒸馏管线 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T04b）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOp, activateInsight } from "@harness/l2-memory";
import type { Insight, InsightOp, MemCtx } from "@harness/l2-memory";

// mock CE-T02 确定性验证器（@harness/canary-eval 的 verify 返回 exit code）
vi.mock("@harness/canary-eval", () => ({
  verify: vi.fn(() => ({ exitCode: 0, stdout: "", stderr: "" })),
}));

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

describe("L2-T04b", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t04b-"));
  });

  function addInsight(ruleText: string, evidenceCount = 2, opts?: { content?: string }) {
    return applyOp(
      "ADD",
      {
        ruleText,
        evidenceCount,
        provenance: {
          sessionId: "sess-1",
          taskId: "t1",
          promptHash: "h1",
          agentId: "a1",
          ts: Date.now(),
        },
        ...(opts?.content ? { content: opts.content } : {}),
      },
      ctx(baseDir),
    );
  }

  it("ADD sets importance=2 status=shadow", () => {
    const ins = addInsight("prefer early return over nested branches", 2) as Insight;
    expect(ins.importance).toBe(2);
    expect(ins.status).toBe("shadow");
  });

  it("ADD rejects evidenceCount<2", () => {
    const fn = () => addInsight("rule", 1);
    expect(fn).toThrow(/evidence|>=|2/i);
  });

  it("ADD rejects concrete path", () => {
    const fn = () =>
      addInsight("edit the file at /etc/passwd", 2, {
        content: "see /etc/passwd",
      });
    expect(fn).toThrow(/path|credential|concrete/i);
  });

  it("ADD rejects credential", () => {
    const fn = () =>
      addInsight("token AKIAEXAMPLE123 is used", 2);
    expect(fn).toThrow(/credential|path|concrete|token|secret/i);
  });

  it("UPVOTE increments importance", () => {
    const ins = addInsight("rule up", 2) as Insight;
    const after = applyOp("UPVOTE", { id: ins.id }, ctx(baseDir)) as Insight;
    expect(after.importance).toBe(ins.importance + 1);
  });

  it("DOWNVOTE decrements", () => {
    const ins = addInsight("rule down", 2) as Insight;
    const after = applyOp("DOWNVOTE", { id: ins.id }, ctx(baseDir)) as Insight;
    expect(after.importance).toBe(ins.importance - 1);
  });

  it("DOWNVOTE to 0 archives not delete", () => {
    const ins = addInsight("rule to zero", 2) as Insight;
    // importance=2 → downvote 2 次到 0
    let cur = applyOp("DOWNVOTE", { id: ins.id }, ctx(baseDir)) as Insight;
    cur = applyOp("DOWNVOTE", { id: ins.id }, ctx(baseDir)) as Insight;
    expect(cur.importance).toBe(0);
    expect(cur.status).toBe("archived");
    // archived 物理可恢复（never-delete）
    const archiveDir = join(baseDir, "archive/expel");
    expect(existsSync(archiveDir)).toBe(true);
    expect(
      readdirSync(archiveDir).some((f) => f.startsWith(ins.id + ".")),
    ).toBe(true);
  });

  it("activate rejects on held-out regression", () => {
    const ins = addInsight("rule reg", 2) as Insight;
    expect(() => activateInsight(ins.id, -0.05)).toThrow(/regression|held-out|delta|decreas/i);
    // 保持 shadow
    // activateInsight 抛错时不改变状态
  });

  it("activate succeeds on held-out improvement", () => {
    const ins = addInsight("rule improve", 2) as Insight;
    const after = activateInsight(ins.id, +0.02) as Insight;
    expect(after.status).toBe("active");
  });

  it("archived insight recoverable", () => {
    const ins = addInsight("rule rec", 2) as Insight;
    applyOp("DOWNVOTE", { id: ins.id }, ctx(baseDir));
    applyOp("DOWNVOTE", { id: ins.id }, ctx(baseDir));
    const archiveDir = join(baseDir, "archive/expel");
    expect(
      readdirSync(archiveDir).some((f) => f.startsWith(ins.id + ".")),
    ).toBe(true);
  });
});
