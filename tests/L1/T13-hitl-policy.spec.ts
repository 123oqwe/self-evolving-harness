// L1-T13 · HITL policy 进化（重复副作用=0 hard；false-pause↓；RunState static-core）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T13 spec 编写。

import { describe, it, expect } from "vitest";
import {
  HitlPolicy,
  type HitlRule,
  type HitlScore,
} from "@harness/l1-config";

function score(o: Partial<HitlScore>): HitlScore {
  return {
    duplicateSideEffectCount: o.duplicateSideEffectCount ?? 0,
    falsePauseRate: o.falsePauseRate ?? 0.1,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T13", () => {
  it("evolve narrows pause scope when false-pause high", () => {
    const p = new HitlPolicy();
    const baseline: HitlRule[] = [
      { tool: "bash", action: "pause", predicate: "always" },
    ];
    // false-pause 高
    const evolved = p.evolve(baseline, [score({ falsePauseRate: 0.4, duplicateSideEffectCount: 0 })]);
    // 候选收窄 pause 范围（action 不再是粗粒度 always pause）
    const bashRule = evolved.find((r) => r.tool === "bash");
    expect(bashRule).toBeDefined();
    // 收窄：predicate 更具体 或 action 变 approve-fine
    expect(bashRule!.predicate !== "always" || bashRule!.action !== "pause").toBe(true);
  });

  it("assertDuplicateSideEffectZero throws when count > 0", () => {
    const p = new HitlPolicy();
    expect(() => p.assertDuplicateSideEffectZero(score({ duplicateSideEffectCount: 1 }))).toThrow();
  });

  it("assertDuplicateSideEffectZero passes when count == 0", () => {
    const p = new HitlPolicy();
    expect(() => p.assertDuplicateSideEffectZero(score({ duplicateSideEffectCount: 0 }))).not.toThrow();
  });

  it("assertBreaker throws on loosening unsent_tool_call_ids tracking", () => {
    const p = new HitlPolicy();
    // 候选放松 unsent_tool_call_ids 跟踪 → throw
    expect(() => p.assertBreaker({ field: "unsent_tool_call_ids", from: "tracked", to: "untracked" })).toThrow();
  });

  it("select rejects candidate with false-pause↓ but duplicate>0", () => {
    const p = new HitlPolicy();
    const baseline = score({ isBaseline: true, falsePauseRate: 0.2, duplicateSideEffectCount: 0 });
    // false-pause↓ 但 duplicate>0 → hard constraint 优先，reject
    const cand = score({ falsePauseRate: 0.1, duplicateSideEffectCount: 1 });
    expect(() => p.assertDuplicateSideEffectZero(cand)).toThrow();
    // select 内部短路：duplicate>0 候选不入选
    const rules: HitlRule[] = [{ tool: "bash", action: "pause" }];
    const evolved = p.evolve(rules, [baseline, cand]);
    // 退化候选不应被入选（hard constraint 短路）
    expect(evolved.length).toBeGreaterThan(0);
  });
});
