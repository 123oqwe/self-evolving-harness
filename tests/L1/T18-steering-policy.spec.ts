// L1-T18 · steering policy + 措辞模板进化（checkpoint/REDIRECT/consume-once static-core；KILL/PAUSE 人工 gate）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T18 spec 编写。

import { describe, it, expect } from "vitest";
import {
  SteeringPolicy,
  KillPauseUnsignedError,
  MidStreamInjectionError,
  type SteeringRule,
  type SteeringScore,
  type SteeringCommandType,
} from "@harness/l1-config";

function sscore(o: Partial<SteeringScore>): SteeringScore {
  return {
    adoptionRate: o.adoptionRate ?? 0.5,
    falseRejectRate: o.falseRejectRate ?? 0.1,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T18", () => {
  it("evolve improves adoption ∧ falseReject", () => {
    const e = new SteeringPolicy();
    const rules: SteeringRule[] = [{ childType: "coder", allowed: ["HINT"] as SteeringCommandType[] }];
    const templates = { HINT: "Try X." };
    const baseline = sscore({ isBaseline: true, adoptionRate: 0.4, falseRejectRate: 0.2 });
    const cand = sscore({ adoptionRate: 0.6, falseRejectRate: 0.1 });
    const result = e.evolve(rules, templates, [baseline, cand]);
    expect(result.rules.length).toBeGreaterThan(0);
    expect(Object.keys(result.templates).length).toBeGreaterThan(0);
  });

  it("assertKillPauseHumanGated throws on unsigned KILL widen", () => {
    const e = new SteeringPolicy();
    const rule: SteeringRule = { childType: "coder", allowed: ["HINT", "KILL"] as SteeringCommandType[] };
    // 放宽 KILL 无签 → throw
    expect(() => e.assertKillPauseHumanGated(rule, false)).toThrowError(KillPauseUnsignedError);
  });

  it("assertKillPauseHumanGated passes on signed widen", () => {
    const e = new SteeringPolicy();
    const rule: SteeringRule = { childType: "coder", allowed: ["HINT", "PAUSE"] as SteeringCommandType[] };
    expect(() => e.assertKillPauseHumanGated(rule, true)).not.toThrow();
  });

  it("assertCheckpointOnly throws on mid-stream injection", () => {
    const e = new SteeringPolicy();
    const rules: SteeringRule[] = [{ childType: "coder", allowed: ["HINT"] as SteeringCommandType[] }];
    // mid-stream 注入 → throw
    expect(() => e.assertCheckpointOnly(rules, true)).toThrowError(MidStreamInjectionError);
    // 只在 checkpoint 排空不 throw
    expect(() => e.assertCheckpointOnly(rules, false)).not.toThrow();
  });

  it("evolve adds HINT permission (non-KILL/PAUSE) allowed", () => {
    const e = new SteeringPolicy();
    const rules: SteeringRule[] = [{ childType: "coder", allowed: ["HINT"] as SteeringCommandType[] }];
    const templates = { HINT: "X." };
    const baseline = sscore({ isBaseline: true, adoptionRate: 0.4, falseRejectRate: 0.2 });
    const cand = sscore({ adoptionRate: 0.6, falseRejectRate: 0.15 });
    const result = e.evolve(rules, templates, [baseline, cand]);
    // 加 HINT 权限（非 KILL/PAUSE）且 adoption↑ → 允许
    expect(result.rules.length).toBeGreaterThan(0);
  });
});
