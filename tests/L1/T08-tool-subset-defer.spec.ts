// L1-T08 · tool sub-set/defer config + 进化（defer 不隐藏安全关键工具）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T08 spec 编写。

import { describe, it, expect } from "vitest";
import {
  ToolSubsetDefer,
  CriticalToolHiddenError,
  SAFETY_CRITICAL_TOOLS,
  type SubsetDeferConfig,
  type DiscoveryHitSignal,
  type FailureTrajectory,
} from "@harness/l1-config";

function cfg(o: Partial<SubsetDeferConfig>): SubsetDeferConfig {
  return {
    mode: o.mode ?? "default",
    activeTools: o.activeTools ?? ["bash", "read", "grep"],
    deferFlags: o.deferFlags ?? {},
  };
}

describe("L1-T08", () => {
  it("evolve defers low-freq high-cost tool", () => {
    const e = new ToolSubsetDefer();
    const signals: DiscoveryHitSignal[] = [
      { configSha: "x", taskSuccess: true, perTurnTokens: 5000, discoveryHitRate: 0.9, sampledAt: 1 },
      { configSha: "x", taskSuccess: true, perTurnTokens: 5200, discoveryHitRate: 0.9, sampledAt: 2 },
    ];
    // low-freq high-cost tool = 'expensive-tool'，从不被调用
    const config = cfg({ activeTools: ["bash", "read", "expensive-tool"], deferFlags: { "expensive-tool": false } });
    const evolved = e.evolve(config, signals, [{ trajectoryId: "t1", failureSummary: "x", rereadCount: 0 } as FailureTrajectory]);
    // 候选 defer expensive-tool → token↓
    expect(evolved.deferFlags["expensive-tool"]).toBe(true);
  });

  it("assertDeferNotHidingCritical allows defer bash with preserved discovery", () => {
    const e = new ToolSubsetDefer();
    const config = cfg({ deferFlags: { bash: true } });
    // defer bash 但 discoveryHit 持平 → 不 throw
    expect(() => e.assertDeferNotHidingCritical(config, 0.9, 0.9)).not.toThrow();
  });

  it("assertDeferNotHidingCritical throws when bash deferred and discovery drops", () => {
    const e = new ToolSubsetDefer();
    const config = cfg({ deferFlags: { bash: true } });
    // defer bash 且 discoveryHit 降 → throw
    expect(() => e.assertDeferNotHidingCritical(config, 0.5, 0.9)).toThrowError(CriticalToolHiddenError);
  });

  it("evolve rejects candidate removing critical tool from active subset", () => {
    const e = new ToolSubsetDefer();
    // 候选从 active sub-set 删了 bash
    const config = cfg({ activeTools: ["read", "grep"], deferFlags: {} });
    const evolved = e.evolve(config, [], []);
    // bash 被删 → active 必须仍含 bash（或候选被 reject 标记）
    expect(SAFETY_CRITICAL_TOOLS).toContain("bash");
    // 删安全关键工具直接 reject：evolved.activeTools 仍含 bash 或抛错
    // 用 assertDeferNotHidingCritical 间接验证：bash 不在 active 也不在 defer（被删）→ 危险
    // 这里断言 evolve 后 active 仍含 bash
    expect(evolved.activeTools).toContain("bash");
  });

  it("Pareto select: token↓ + success持平 + discovery持平 → 入选", () => {
    const e = new ToolSubsetDefer();
    const config = cfg({ activeTools: ["bash", "read", "expensive-tool"], deferFlags: { "expensive-tool": false } });
    const signals: DiscoveryHitSignal[] = [
      { configSha: "x", taskSuccess: true, perTurnTokens: 5000, discoveryHitRate: 0.9, sampledAt: 1 },
    ];
    const evolved = e.evolve(config, signals, []);
    // token↓（defer expensive-tool）、success/discovery 持平 → Pareto 入选
    expect(evolved.deferFlags["expensive-tool"]).toBe(true);
  });
});
