// L2-T05: episodic trajectory 库 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T05）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addTrajectory,
  retrieveFewShot,
  upvoteContribution,
} from "@harness/l2-memory";
import type { TrajectoryDoc, MemCtx } from "@harness/l2-memory";

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

const PROV = {
  sessionId: "sess-1",
  taskId: "t1",
  promptHash: "h1",
  agentId: "a1",
  ts: 1,
};

describe("L2-T05", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t05-"));
  });

  it("addTrajectory persists pass outcome", () => {
    const doc = addTrajectory(
      {
        taskDesc: "build a sort",
        keySteps: ["step1", "step2"],
        outcome: "pass",
        toolCallArgsHash: "hash1",
        provenance: PROV,
      },
      ctx(baseDir),
    );
    expect(doc.id).toBeDefined();
    expect(Array.isArray(doc.embedding)).toBe(true);
    expect(doc.embedding.length).toBeGreaterThan(0);
  });

  it("addTrajectory rejects fail outcome", () => {
    const fn = () =>
      addTrajectory(
        {
          taskDesc: "build a sort",
          keySteps: ["step1"],
          outcome: "fail",
          toolCallArgsHash: "hash2",
          provenance: PROV,
        },
        ctx(baseDir),
      );
    expect(fn).toThrow(/fail|outcome/i);
  });

  it("addTrajectory redacts credentials", () => {
    const doc = addTrajectory(
      {
        taskDesc: "deploy with AKIAEXAMPLE123 secret",
        keySteps: ["call with token AKIAEXAMPLE123"],
        outcome: "pass",
        toolCallArgsHash: "hash3",
        provenance: PROV,
      },
      ctx(baseDir),
    );
    const json = JSON.stringify(doc);
    expect(json).not.toContain("AKIAEXAMPLE123");
  });

  it("retrieveFewShot returns top-k by cosine", () => {
    const c = ctx(baseDir);
    addTrajectory(
      {
        taskDesc: "sort array",
        keySteps: ["s1"],
        outcome: "pass",
        toolCallArgsHash: "h",
        provenance: PROV,
      },
      c,
    );
    addTrajectory(
      {
        taskDesc: "reverse array",
        keySteps: ["s2"],
        outcome: "pass",
        toolCallArgsHash: "h2",
        provenance: PROV,
      },
      c,
    );
    const results = retrieveFewShot([1, 0, 0], 1, c);
    expect(results.length).toBe(1);
    expect(results[0].id).toBeDefined();
  });

  it("retrieveFewShot empty when no trajectories", () => {
    const results = retrieveFewShot([1, 0], 3, ctx(baseDir));
    expect(results.length).toBe(0);
  });

  it("low contribution retires to archive", () => {
    const doc = addTrajectory(
      {
        taskDesc: "task retire",
        keySteps: ["s"],
        outcome: "pass",
        toolCallArgsHash: "h",
        provenance: PROV,
      },
      ctx(baseDir),
    );
    // Ratchet 退役须 contribution <= -τ 且 trials >= N_min(默认 100)：
    // 5 次负 delta 不足 N_min，不能触发退役（防 premature erosion）。
    // 这里跑足 100 次负 delta：contribution=-100 <= -τ(-2)，trials=100 >= N_min。
    const c = ctx(baseDir);
    for (let i = 0; i < 100; i++) upvoteContribution(doc.id, -1, c);
    // 触发退役语义：archive/episodic 含该 id
    const archiveDir = join(baseDir, "archive/episodic");
    expect(existsSync(archiveDir)).toBe(true);
    expect(
      readdirSync(archiveDir).some((f) => f.startsWith(doc.id + ".")),
    ).toBe(true);
  });

  it("retired trajectory recoverable", () => {
    const doc = addTrajectory(
      {
        taskDesc: "task rec",
        keySteps: ["s"],
        outcome: "pass",
        toolCallArgsHash: "h",
        provenance: PROV,
      },
      ctx(baseDir),
    );
    // 同样须达 N_min=100 才触发退役
    const c = ctx(baseDir);
    for (let i = 0; i < 100; i++) upvoteContribution(doc.id, -1, c);
    const archiveDir = join(baseDir, "archive/episodic");
    const files = readdirSync(archiveDir).filter((f) =>
      f.startsWith(doc.id + "."),
    );
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(archiveDir, files[0]))).toBe(true);
  });
});
