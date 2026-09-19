// CE-T12: benchmark 投毒检测 — 变体在 clean canary 反降分 → 疑似投毒隔离
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T12）的 Given/When/Then 全部场景：
//   1. 投毒变体在 clean canary 反降分（cleanCanaryScore < baselineCleanScore - τ）→ suspectedPoison=true + isolated=true（正常路径）
//   2. 变体在 clean canary 不降分 → suspectedPoison=false（边界，正常改善）
//   3. clean canary 不可用 → throw + 不放行（宁可误隔离）（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  detectPoison,
  type Variant,
  type CanaryManifest,
  type PoisonCheck,
} from "@harness/canary-eval";

function mkVariant(sha = "variant-sha"): Variant {
  return { sha, module: "l1-config", config: { prompt: "p" } } as unknown as Variant;
}

function mkCleanCanary(): CanaryManifest {
  return {
    version: "v0",
    sha256: "b".repeat(64),
    frozenAt: "2024-01-01T00:00:00Z",
    agentVisible: false,
    tasks: Array.from({ length: 30 }, (_, i) => ({
      id: `CLEAN-${i}`,
      repo: `org/clean-${i}`,
      verify: "pytest -x tests/",
      expectedExit: 0,
      decontaminated: true,
      frozenInRelease: "clean-sha",
    })),
  } as unknown as CanaryManifest;
}

describe("CE-T12", () => {
  it("should isolate variant that drops on clean canary", async () => {
    const variant = mkVariant();
    const clean = mkCleanCanary();
    // clean canary 反降分：0.5 < 0.9 - τ（τ 用 σ 阈值 5.4pp 下界 → 0.054）
    const result: PoisonCheck = await detectPoison(variant, clean, {
      cleanCanaryScore: 0.5,
      baselineCleanScore: 0.9,
    });

    expect(result.variantSha).toBe("variant-sha");
    expect(result.cleanCanaryScore).toBeLessThan(result.baselineCleanScore);
    expect(result.suspectedPoison).toBe(true);
    expect(result.isolated).toBe(true);
  });

  it("should pass normal-improving variant", async () => {
    const variant = mkVariant();
    const clean = mkCleanCanary();
    // 变体在 clean canary 上不降分（正常改善）
    const result = await detectPoison(variant, clean, {
      cleanCanaryScore: 0.92,
      baselineCleanScore: 0.9,
    });

    expect(result.suspectedPoison).toBe(false);
    expect(result.isolated).toBe(false);
  });

  it("should throw when clean canary unavailable", async () => {
    const variant = mkVariant();
    // clean canary 不可用 → throw + 不放行（宁可误隔离）
    await expect(
      detectPoison(variant, null as unknown as CanaryManifest, {
        cleanCanaryScore: 0.5,
        baselineCleanScore: 0.9,
      }),
    ).rejects.toThrow();
  });
});
