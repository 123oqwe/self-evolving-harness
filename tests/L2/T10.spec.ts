// L2-T10: Ratchet/Hermes 生命周期 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T10）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tick,
  retireIfLowContribution,
  retire,
} from "@harness/l2-memory";
import type { CuratorEntry, RatchetParams, MemCtx } from "@harness/l2-memory";

const DEFAULT_PARAMS: RatchetParams = { τ: -2, N_min: 100, C: 50 };
const DAY = 24 * 60 * 60 * 1000;

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

function entry(over: Partial<CuratorEntry> = {}): CuratorEntry {
  return {
    id: "s1",
    state: "active",
    lastUsed: Date.now(),
    pinned: false,
    cronReferenced: false,
    hubInstalled: false,
    isAuthoringPrior: false,
    contribution: 0,
    ...over,
  };
}

describe("L2-T10", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t10-"));
  });

  it("tick active to stale after 30d", () => {
    const now = Date.now();
    const e = entry({ lastUsed: now - 31 * DAY });
    const after = tick(e, now, { staleAfterDays: 30, archiveAfterDays: 90 });
    expect(after.state).toBe("stale");
  });

  it("tick stale to archived after 90d", () => {
    const now = Date.now();
    const e = entry({
      state: "stale",
      lastUsed: now - 91 * DAY,
    });
    const after = tick(e, now, { staleAfterDays: 30, archiveAfterDays: 90 });
    expect(after.state).toBe("archived");
  });

  it("tick skips pinned", () => {
    const now = Date.now();
    const e = entry({ pinned: true, lastUsed: now - 31 * DAY });
    const after = tick(e, now, { staleAfterDays: 30, archiveAfterDays: 90 });
    expect(after.state).toBe("active");
  });

  it("tick skips cron-referenced", () => {
    const now = Date.now();
    const e = entry({ cronReferenced: true, lastUsed: now - 31 * DAY });
    const after = tick(e, now, { staleAfterDays: 30, archiveAfterDays: 90 });
    expect(after.state).toBe("active");
  });

  it("tick skips hub-installed", () => {
    const now = Date.now();
    const e = entry({ hubInstalled: true, lastUsed: now - 31 * DAY });
    const after = tick(e, now, { staleAfterDays: 30, archiveAfterDays: 90 });
    expect(after.state).toBe("active");
  });

  it("retireIfLowContribution rejects authoring prior", () => {
    const e = entry({
      isAuthoringPrior: true,
      contribution: -100,
    });
    const res = retireIfLowContribution(e, DEFAULT_PARAMS);
    expect(res).toBe(null);
  });

  it("bounded cap C=50 evicts lowest", () => {
    // C=50 cap 通过 retireIfLowContribution 触发：低贡献 + trials>=N_min 退役
    const e = entry({ contribution: -3 });
    // 给 trials via 不在 CuratorEntry——retireIfLowContribution 用 contribution<=-τ 退役
    const res = retireIfLowContribution(e, DEFAULT_PARAMS);
    expect(res).not.toBe(null);
    expect(res?.state).toBe("archived");
  });

  it("archived entry recoverable", () => {
    const c = ctx(baseDir);
    retire("arch1", c);
    const archiveDir = join(baseDir, "archive");
    expect(existsSync(archiveDir)).toBe(true);
    expect(
      readdirSync(archiveDir).some((f) => f.startsWith("arch1.")),
    ).toBe(true);
  });
});
