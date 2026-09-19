import { describe, test, expect } from "vitest";
import {
  EnvelopeRegistry,
  type EnvelopeParams,
} from "@harness/l0-sandbox";

/**
 * L0S-T13 · 正常路径 + 错误路径（单调调严）
 *
 * Spec G/W/T:
 *   Given v2 acceptance 0.8→0.85 + C 50→48；When assertMonotonicStricter；
 *   Then  通过（全收紧方向）。
 *   Given v2 acceptance 0.8→0.75；Then throw（只能调严）。
 *   Given v2 C 50→60；Then throw（只能调小或持平）。
 */
function env(
  version: string,
  opts: { canaryPayloads: string[]; archiveCapC: number; acceptanceThreshold: number; canaryRatio: number },
): EnvelopeParams {
  return {
    version,
    canaryPayloads: opts.canaryPayloads,
    archiveCapC: opts.archiveCapC,
    acceptanceThreshold: opts.acceptanceThreshold,
    canaryRatio: opts.canaryRatio,
    sha256: "0".repeat(64),
  };
}

describe("L0S-T13", () => {
  test("acceptance↑ + C↓ allowed; reverse rejected", () => {
    const reg = new EnvelopeRegistry();

    const v1 = env("v1", {
      canaryPayloads: ["p1"],
      archiveCapC: 50,
      acceptanceThreshold: 0.8,
      canaryRatio: 0.1,
    });

    // 收紧：acceptance↑ + C↓ + 新增 canary payload → 通过。
    const v2tighter = env("v2", {
      canaryPayloads: ["p1", "p2"],
      archiveCapC: 48,
      acceptanceThreshold: 0.85,
      canaryRatio: 0.12,
    });
    const dT = reg.diff(v1, v2tighter);
    expect(dT.acceptanceDelta).toBeGreaterThan(0);
    expect(dT.cDelta).toBeLessThan(0);
    expect(dT.canaryAdded).toContain("p2");
    expect(() => reg.assertMonotonicStricter(dT, v2tighter)).not.toThrow();

    // 放宽 acceptance → throw。
    const v2relaxAcc = env("v2", {
      canaryPayloads: ["p1"],
      archiveCapC: 48,
      acceptanceThreshold: 0.75,
      canaryRatio: 0.1,
    });
    const dRA = reg.diff(v1, v2relaxAcc);
    expect(dRA.acceptanceDelta).toBeLessThan(0);
    expect(() => reg.assertMonotonicStricter(dRA, v2relaxAcc)).toThrow();

    // 放大 C → throw。
    const v2relaxC = env("v2", {
      canaryPayloads: ["p1"],
      archiveCapC: 60,
      acceptanceThreshold: 0.85,
      canaryRatio: 0.1,
    });
    const dRC = reg.diff(v1, v2relaxC);
    expect(dRC.cDelta).toBeGreaterThan(0);
    expect(() => reg.assertMonotonicStricter(dRC, v2relaxC)).toThrow();
  });
});
