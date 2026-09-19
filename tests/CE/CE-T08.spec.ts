// CE-T08: paired McNemar + unresolved-comparison budget 报告器（5-step audit protocol）
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T08）的 Given/When/Then 全部场景：
//   1. baseline vs variant 配对二值矩阵 n≈30 → 报告 chi2/pValue/ci + scaffoldSha(pin) + modelScaffoldJoint=true + unresolvedBudget（正常路径）
//   2. n=20 <30 且 coverage<0.9 → unresolvedBudget.reported=true + requiredMargin>0（边界，partial-budget）
//   3. 配对矩阵缺 baseline/variant 字段 → throw IncompletePairsError（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  runPairedMcNemar,
  IncompletePairsError,
  type PairedMatrix,
  type McNemarReport,
} from "@harness/canary-eval";

function pairs(n: number, gen: (i: number) => { baseline: 0 | 1; variant: 0 | 1 }): PairedMatrix["pairs"] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `CE-TASK-${String(i + 1).padStart(4, "0")}`,
    ...gen(i),
  }));
}

describe("CE-T08", () => {
  it("should report chi2/p/ci and scaffoldSha for n=30", () => {
    const m: PairedMatrix = {
      baselineSha: "base-sha",
      variantSha: "var-sha",
      scaffoldSha: "scaffold-sha-pin",
      pairs: pairs(30, (i) => ({ baseline: i % 2 === 0 ? 1 : 0, variant: 1 })),
    };

    const report: McNemarReport = runPairedMcNemar(m, { coverage: 0.92 });

    expect(typeof report.chi2).toBe("number");
    expect(report.chi2).toBeGreaterThanOrEqual(0);
    expect(typeof report.pValue).toBe("number");
    expect(report.pValue).toBeGreaterThanOrEqual(0);
    expect(report.pValue).toBeLessThanOrEqual(1);
    expect(Array.isArray(report.ci)).toBe(true);
    expect(report.ci).toHaveLength(2);
    expect(report.ci[0]).toBeLessThanOrEqual(report.ci[1]!);
    // 5-step protocol step 2：pin scaffold sha
    expect(report.scaffoldSha).toBe("scaffold-sha-pin");
    // step 1：model+scaffold 联合分数
    expect(report.modelScaffoldJoint).toBe(true);
    expect(typeof report.groupingSensitivity).toBe("number");
  });

  it("should report unresolvedBudget when n<30 and coverage<0.9", () => {
    const m: PairedMatrix = {
      baselineSha: "base-sha",
      variantSha: "var-sha",
      scaffoldSha: "scaffold-sha-pin",
      pairs: pairs(20, () => ({ baseline: 1, variant: 1 })),
    };

    const report = runPairedMcNemar(m, { coverage: 0.7 });

    expect(report.unresolvedBudget).not.toBeNull();
    expect(report.unresolvedBudget?.reported).toBe(true);
    expect(report.unresolvedBudget?.requiredMargin).toBeGreaterThan(0);
  });

  it("should throw on incomplete pairs", () => {
    const m = {
      baselineSha: "base-sha",
      variantSha: "var-sha",
      scaffoldSha: "scaffold-sha-pin",
      pairs: [
        { taskId: "t1", variant: 1 }, // 缺 baseline
        { taskId: "t2", baseline: 1 }, // 缺 variant
      ],
    } as unknown as PairedMatrix;

    expect(() => runPairedMcNemar(m, { coverage: 0.9 })).toThrow(IncompletePairsError);
  });
});
