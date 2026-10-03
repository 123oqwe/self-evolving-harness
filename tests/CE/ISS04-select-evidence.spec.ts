// ISS-04: selectWithEvidence 统计证据门。
import { describe, it, expect } from "vitest";
import { selectWithEvidence } from "@harness/canary-eval";

function mkPairs(n: number, b: number, c: number) {
  const pairs = [];
  for (let i = 0; i < b; i++) pairs.push({ taskId: `t-${i}`, baseline: 1, variant: 0 });
  for (let i = 0; i < c; i++) pairs.push({ taskId: `t-${b + i}`, baseline: 0, variant: 1 });
  const agree = n - b - c;
  for (let i = 0; i < agree; i++) pairs.push({ taskId: `t-${b + c + i}`, baseline: 1, variant: 1 });
  return pairs;
}

describe("ISS-04 · selectWithEvidence", () => {
  it("underpowered when n < minTasks", () => {
    const r = selectWithEvidence(
      { baselineSha: "b", variantSha: "v", scaffoldSha: "s", pairs: mkPairs(3, 0, 2) },
      { minTasks: 30 },
    );
    expect(r.decision).toBe("underpowered");
  });

  it("accept on significant improvement (c > b, p < alpha)", () => {
    // 30 tasks, 10 discordant all favoring variant, n>=minTasks=30
    const r = selectWithEvidence(
      { baselineSha: "b", variantSha: "v", scaffoldSha: "s", pairs: mkPairs(30, 0, 10) },
      { minTasks: 30, alpha: 0.05 },
    );
    expect(r.decision).toBe("accept");
    expect(r.c).toBeGreaterThan(r.b);
  });

  it("reject on significant regression (c < b)", () => {
    const r = selectWithEvidence(
      { baselineSha: "b", variantSha: "v", scaffoldSha: "s", pairs: mkPairs(30, 10, 0) },
      { minTasks: 30 },
    );
    expect(r.decision).toBe("reject");
  });

  it("reject on non-significant (p >= alpha)", () => {
    // 30 tasks, 1 discordant pair → not significant
    const r = selectWithEvidence(
      { baselineSha: "b", variantSha: "v", scaffoldSha: "s", pairs: mkPairs(30, 0, 1) },
      { minTasks: 30 },
    );
    expect(r.decision).toBe("reject");
  });
});
