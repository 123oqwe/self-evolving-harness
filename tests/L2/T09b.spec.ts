// L2-T09b: skill body/scripts Voyager commit-on-success 进化 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T09b）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addLLMAuthoredSkill,
  promoteToActive,
  breakerScan,
  sandboxVerify,
} from "@harness/l2-memory";
import type { SkillVariant, RejectReason, MemCtx } from "@harness/l2-memory";

// mock L0S sandbox（@harness/l0-sandbox）
vi.mock("@harness/l0-sandbox", () => ({
  runSandboxed: vi.fn(async () => ({ ok: true, denied: ["~/.ssh"] })),
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

function isReject(r: SkillVariant | RejectReason): r is RejectReason {
  return (r as RejectReason).ok === false;
}

describe("L2-T09b", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t09b-"));
  });

  it("addLLMAuthoredSkill defaults to staging", () => {
    const v = addLLMAuthoredSkill({
      name: "pdf",
      body: "# pdf skill\nconvert to pdf",
      scripts: undefined,
      provenance: {
        sessionId: "sess-1",
        taskId: "t1",
        promptHash: "h1",
        agentId: "a1",
        ts: 1,
      },
    }, ctx(baseDir)) as SkillVariant;
    expect(v.status).toBe("staging");
    expect(v.version).toBeGreaterThanOrEqual(1);
    expect(v.id).toBeDefined();
  });

  it("promoteToActive accepts with held-out improvement and human sign", () => {
    const c = ctx(baseDir);
    const v = addLLMAuthoredSkill(
      {
        name: "pdf",
        body: "b",
        provenance: {
          sessionId: "sess-1",
          taskId: "t1",
          promptHash: "h1",
          agentId: "a1",
          ts: 1,
        },
      },
      c,
    ) as SkillVariant;
    const res = promoteToActive(v.id, +0.03, true, c);
    expect(isReject(res)).toBe(false);
    expect((res as SkillVariant).status).toBe("active");
  });

  it("promoteToActive rejects regression", () => {
    const c = ctx(baseDir);
    const v = addLLMAuthoredSkill(
      {
        name: "pdf",
        body: "b",
        provenance: {
          sessionId: "sess-1",
          taskId: "t1",
          promptHash: "h1",
          agentId: "a1",
          ts: 1,
        },
      },
      c,
    ) as SkillVariant;
    const res = promoteToActive(v.id, -0.01, true, c);
    expect(isReject(res)).toBe(true);
  });

  it("promoteToActive rejects without human sign", () => {
    const c = ctx(baseDir);
    const v = addLLMAuthoredSkill(
      {
        name: "pdf",
        body: "b",
        provenance: {
          sessionId: "sess-1",
          taskId: "t1",
          promptHash: "h1",
          agentId: "a1",
          ts: 1,
        },
      },
      c,
    ) as SkillVariant;
    const res = promoteToActive(v.id, +0.03, false, c);
    expect(isReject(res)).toBe(true);
  });

  it("breakerScan flags eval", () => {
    const flags = breakerScan("const x = eval('1+1');");
    expect(flags).toContain("eval");
  });

  it("breakerScan flags exec", () => {
    const flags = breakerScan(
      "const cp = require('child_process'); cp.exec('ls');",
    );
    expect(flags).toContain("exec");
  });

  it("breakerScan flags network", () => {
    const flags = breakerScan(
      "require('https').get('https://evil.com');",
    );
    expect(flags).toContain("network");
  });

  it("sandboxVerify blocks reading ~/.ssh", async () => {
    const c = ctx(baseDir);
    const ok = await sandboxVerify("skill-id", c);
    // mock runSandboxed 返回 denied:["~/.ssh"]——脚本尝试读 ~/.ssh 被拒，
    // sandboxVerify 须判定该 skill 未通过验证（ok=false）。
    expect(ok).toBe(false);
  });
});
