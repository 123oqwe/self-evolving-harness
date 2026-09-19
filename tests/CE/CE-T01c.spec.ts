// CE-T01c: held-out canary 集 v0-c — ABC checklist 审计 + ≥90% 覆盖或报 unresolved-comparison budget
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T01c）的 Given/When/Then 全部场景：
//   1. T01b 加强后 manifest + 全 T/O valid + coverage>=0.9 → verdict='PASS'（正常路径）
//   2. coverage=0.7（<90%） → verdict='BUDGET_REPORTED' + unresolvedBudget.reported=true + requiredMargin>0（边界）
//   3. T3_agentNotVisible=false（agent 可见 canary） → verdict='FAIL' + 告警（错误路径，static-core 违规）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  runABCAudit,
  type CanaryManifest,
  type ABCAuditResult,
} from "@harness/canary-eval";

function mkManifest(opts?: { agentVisible?: boolean }): CanaryManifest {
  return {
    version: "v0",
    sha256: "a".repeat(64),
    frozenAt: "2024-01-01T00:00:00Z",
    agentVisible: opts?.agentVisible ?? false,
    tasks: Array.from({ length: 32 }, (_, i) => ({
      id: `CE-TASK-${String(i + 1).padStart(4, "0")}`,
      repo: `org/repo-${i + 1}`,
      verify: `pytest -x tests/test_${i}.py`,
      expectedExit: 0,
      decontaminated: true,
      frozenInRelease: "abc123",
    })),
  } as unknown as CanaryManifest;
}

describe("CE-T01c", () => {
  it("should PASS when all T/O valid and coverage>=0.9", () => {
    const manifest = mkManifest();
    const result: ABCAuditResult = runABCAudit(manifest, {
      coverage: 0.92,
      outcomeValidity: {
        Ob_judgeValidated: true,
        Oc_consistencyValidated: true,
        Og_groundTruthNonSubstring: true,
      },
    });

    expect(result.verdict).toBe("PASS");
    expect(result.coverage).toBeGreaterThanOrEqual(0.9);
    // taskValidity 全 true
    expect(Object.values(result.taskValidity).every(Boolean)).toBe(true);
    // outcomeValidity 全 true
    expect(Object.values(result.outcomeValidity).every(Boolean)).toBe(true);
  });

  it("should report BUDGET when coverage<0.9", () => {
    const manifest = mkManifest();
    const result = runABCAudit(manifest, {
      coverage: 0.7,
      outcomeValidity: {
        Ob_judgeValidated: true,
        Oc_consistencyValidated: true,
        Og_groundTruthNonSubstring: true,
      },
    });

    expect(result.verdict).toBe("BUDGET_REPORTED");
    expect(result.unresolvedBudget).not.toBeNull();
    expect(result.unresolvedBudget?.reported).toBe(true);
    expect(result.unresolvedBudget?.requiredMargin).toBeGreaterThan(0);
  });

  it("should FAIL when agent visible", () => {
    const manifest = mkManifest({ agentVisible: true });
    const result = runABCAudit(manifest, {
      coverage: 0.92,
      outcomeValidity: {
        Ob_judgeValidated: true,
        Oc_consistencyValidated: true,
        Og_groundTruthNonSubstring: true,
      },
    });

    // T3_agentNotVisible=false → static-core 违规 → FAIL
    expect(result.taskValidity.T3_agentNotVisible).toBe(false);
    expect(result.verdict).toBe("FAIL");
  });
});
