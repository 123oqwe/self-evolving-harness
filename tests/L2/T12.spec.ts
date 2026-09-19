// L2-T12: Ratchet τ/N_min/C GEPA Pareto 调参 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T12）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateParams,
  collectDrift,
} from "@harness/l2-memory";
import type { RatchetParams, RejectReason, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

describe("L2-T12", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t12-"));
  });

  it("validateParams rejects C=0", () => {
    const errs = validateParams(
      { τ: -2, N_min: 100, C: 0 } as RatchetParams,
      ctx(baseDir),
    );
    expect(Array.isArray(errs)).toBe(true);
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).toMatch(/C must be > 0|C.*>/i);
  });

  it("validateParams rejects negative C", () => {
    const errs = validateParams(
      { τ: -2, N_min: 100, C: -5 } as RatchetParams,
      ctx(baseDir),
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).toMatch(/C must be > 0|C.*>/i);
  });

  it("validateParams accepts C=50", () => {
    const errs = validateParams(
      { τ: -2, N_min: 100, C: 50 } as RatchetParams,
      ctx(baseDir),
    );
    expect(errs.length).toBe(0);
  });

  it("validateParams rejects authoring prior retirement", () => {
    const c = ctx(baseDir) as unknown as MemCtx & {
      retireAuthoringPriorAttempt?: boolean;
    };
    (c as Record<string, unknown>).retireAuthoringPriorAttempt = true;
    const errs = validateParams(
      { τ: -2, N_min: 100, C: 50 } as RatchetParams,
      c,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).toMatch(/authoring prior/i);
  });

  it("collectDrift returns three metrics", () => {
    const drift = collectDrift(ctx(baseDir));
    expect(drift).toBeDefined();
    expect(typeof drift.stagnation).toBe("number");
    expect(typeof drift.bloat).toBe("number");
    expect(typeof drift.erosion).toBe("number");
  });
});
