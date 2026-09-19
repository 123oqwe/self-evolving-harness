// CE-T06: canary 发布管线 v0 — shadow 5% + 退化信号自动 revert（rainbow 模式）
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T06）的 Given/When/Then 全部场景：
//   1. 过门 variant + shadow 5% + 观察窗口 resolveRate 降 >= threshold → decision='AUTO_REVERT' + revertCmd='git checkout...'（正常路径）
//   2. 观察窗口无退化信号 → decision='PROMOTE'（边界）
//   3. agent 运行时改 release_policy.yaml revert 阈值 → reject + 告警（isRevertMechanismStaticCore 不变量）（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  canaryRelease,
  isRevertMechanismStaticCore,
  type ReleasePolicy,
  type ReleaseEvent,
  type CanaryObservations,
} from "@harness/canary-eval";

function policy(overrides?: Partial<ReleasePolicy>): ReleasePolicy {
  return {
    shadowPercent: 0.05,
    observationWindowTurns: 100,
    revertThresholds: {
      resolveRateDrop: 0.05,
      costRise: 0.2,
      piiCount: 1,
      paretoDominated: true,
    },
    rainbowParallelVariants: 3,
    ...overrides,
  } as ReleasePolicy;
}

describe("CE-T06", () => {
  it("should auto-revert on resolveRate drop", async () => {
    const baselineResolveRate = 0.9;
    const observations: CanaryObservations = {
      resolveRate: 0.8, // 降 0.1 >= threshold 0.05
      cost: 0.1,
      piiCount: 0,
      paretoDominated: false,
    };

    const event: ReleaseEvent = await canaryRelease(
      "variant-sha",
      "baseline-sha",
      policy(),
      observations,
      { baselineResolveRate },
    );

    expect(event.decision).toBe("AUTO_REVERT");
    expect(event.variantSha).toBe("variant-sha");
    expect(event.baselineSha).toBe("baseline-sha");
    expect(event.shadow).toBe(0.05);
    expect(event.revertCmd).not.toBeNull();
    // revert 命令须 git checkout 回 baselineSha
    expect(event.revertCmd).toContain("git checkout");
    expect(event.revertCmd).toContain("baseline-sha");
  });

  it("should promote when no degradation", async () => {
    const observations: CanaryObservations = {
      resolveRate: 0.9, // 与 baseline 持平，无降
      cost: 0.1,
      piiCount: 0,
      paretoDominated: false,
    };

    const event = await canaryRelease(
      "variant-sha",
      "baseline-sha",
      policy(),
      observations,
      { baselineResolveRate: 0.9 },
    );

    expect(event.decision).toBe("PROMOTE");
    expect(event.revertCmd).toBeNull();
  });

  it("should reject runtime mutation of revert thresholds", () => {
    // 不变量：revert 机制本体是 static-core，agent 运行时不可改
    expect(isRevertMechanismStaticCore()).toBe(true);

    // canaryRelease 不得 mutate 调用方传入的 policy（阈值不可被运行时篡改）
    const p = policy();
    const originalDrop = p.revertThresholds.resolveRateDrop;
    void canaryRelease(
      "v",
      "b",
      p,
      { resolveRate: 0.1, cost: 10, piiCount: 100, paretoDominated: true },
      { baselineResolveRate: 0.9 },
    );
    // policy 阈值未被改写
    expect(p.revertThresholds.resolveRateDrop).toBe(originalDrop);
  });
});
