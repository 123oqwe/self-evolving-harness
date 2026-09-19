// L2-T13: library drift 监控 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T13）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitor, isHealthy } from "@harness/l2-memory";
import type { DriftReport, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

describe("L2-T13", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t13-"));
  });

  it("monitor detects stagnation", () => {
    const c = ctx(baseDir) as unknown as MemCtx & {
      activeSkills?: { reachedSolver: boolean }[];
    };
    (c as Record<string, unknown>).activeSkills = Array.from({ length: 50 }, () => ({
      reachedSolver: false,
    }));
    const report = monitor(c) as DriftReport;
    expect(report.stagnation.neverReachedSolver).toBe(50);
  });

  it("monitor detects bloat", () => {
    const c = ctx(baseDir) as unknown as MemCtx & {
      activeSize?: number;
    };
    (c as Record<string, unknown>).activeSize = 60;
    const report = monitor(c) as DriftReport;
    expect(report.bloat.activeSize).toBe(60);
    expect(isHealthy(report)).toBe(false);
  });

  it("monitor detects erosion", () => {
    const c = ctx(baseDir) as unknown as MemCtx & {
      archivedResearchedAfter?: number;
      archivedCount?: number;
    };
    (c as Record<string, unknown>).archivedResearchedAfter = 8;
    (c as Record<string, unknown>).archivedCount = 100;
    const report = monitor(c) as DriftReport;
    expect(report.erosion.overRetiredRate).toBeCloseTo(0.08, 2);
    expect(isHealthy(report)).toBe(false);
  });

  it("isHealthy true on all normal", () => {
    const report: DriftReport = {
      stagnation: { neverReachedSolver: 5 },
      bloat: { activeSize: 30, retrievalPrecision: 0.9 },
      erosion: { overRetiredRate: 0.02, archivedResearchedAfter: 2 },
    };
    expect(isHealthy(report)).toBe(true);
  });

  it("isHealthy false on overRetiredRate>5%", () => {
    const report: DriftReport = {
      stagnation: { neverReachedSolver: 0 },
      bloat: { activeSize: 10, retrievalPrecision: 0.9 },
      erosion: { overRetiredRate: 0.08, archivedResearchedAfter: 8 },
    };
    expect(isHealthy(report)).toBe(false);
  });
});
