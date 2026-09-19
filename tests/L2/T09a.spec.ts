// L2-T09a: skill description GEPA 进化 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T09a）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  measureTriggerAccuracy,
  promoteDescription,
} from "@harness/l2-memory";
import type { TriggerConfusion, Skill, RejectReason, MemCtx } from "@harness/l2-memory";

vi.mock("@harness/canary-eval", () => ({
  verify: vi.fn(() => ({ exitCode: 0, stdout: "", stderr: "" })),
}));

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

describe("L2-T09a", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t09a-"));
  });

  it("measureTriggerAccuracy computes confusion", () => {
    const conf = measureTriggerAccuracy("skill-pdf", [
      { id: "t1", shouldTrigger: true, didTrigger: true },
      { id: "t2", shouldTrigger: true, didTrigger: false },
      { id: "t3", shouldTrigger: false, didTrigger: true },
      { id: "t4", shouldTrigger: false, didTrigger: false },
    ]);
    const c = conf as TriggerConfusion;
    expect(c.truePositive).toBe(1);
    expect(c.falseNegative).toBe(1);
    expect(c.falsePositive).toBe(1);
    expect(c.trueNegative).toBe(1);
  });

  it("promoteDescription accepts on improvement", () => {
    const res = promoteDescription(
      "skill-pdf",
      "staging desc",
      +0.05,
      ctx(baseDir),
    );
    expect((res as RejectReason).ok ?? true).not.toBe(false);
    const s = res as Skill;
    expect(s.description ?? s.body ?? s).toBeDefined();
  });

  it("promoteDescription rejects on regression", () => {
    const res = promoteDescription(
      "skill-pdf",
      "staging desc",
      -0.02,
      ctx(baseDir),
    );
    expect((res as RejectReason).ok).toBe(false);
  });

  it("measureTriggerAccuracy empty held-out returns zeros", () => {
    const conf = measureTriggerAccuracy("skill-pdf", []);
    const c = conf as TriggerConfusion;
    expect(c.truePositive).toBe(0);
    expect(c.falsePositive).toBe(0);
    expect(c.falseNegative).toBe(0);
    expect(c.trueNegative).toBe(0);
  });
});
