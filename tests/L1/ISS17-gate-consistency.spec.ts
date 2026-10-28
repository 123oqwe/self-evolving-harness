// ISS-17: 6 处 strict-improvement 门语义一致性。
//
// 评审 ISS-17 实证：ISS-01 只修了 l3-engine 的严格门（Δ=0 必须 reject），
// l1-config 中仍有 3 处沿用「不退化为过」的旧语义（Δ=0 放行）：
//   - contextModeStrictImprovementGate (context-mode-router.ts)
//   - reducerStrictImprovementGate     (reducer-partition.ts)
//   - DelegationSubstrate.strictImprovementGate (delegation-substrate.ts)
// 其余 3 处已要求「至少一项严格改善」：
//   - recoveryStrictImprovementGate / hookStrictImprovementGate / steeringStrictImprovementGate
//
// 本测试锁定 6 个门在三种场景下结论一致：
//   1. Δ=0（完全无变化）        → reject（ISS-01 语义）
//   2. 严格改善（至少一项更优）  → accept
//   3. 任一项退化超 τ           → reject
//
// RED 预期：3 个旧语义门在场景 1 返回 true。

import { describe, it, expect } from "vitest";
import {
  contextModeStrictImprovementGate,
  reducerStrictImprovementGate,
  recoveryStrictImprovementGate,
  hookStrictImprovementGate,
  steeringStrictImprovementGate,
  DelegationSubstrate,
} from "@harness/l1-config";

const TAU = 0.02;

/** 每个门的三种场景调用（候选 vs 基线）。 */
interface GateCase {
  name: string;
  /** Δ=0：候选与基线完全相同。 */
  atZero: () => boolean;
  /** 严格改善：至少一项更优、其余不劣化。 */
  strictImprove: () => boolean;
  /** 退化：某一项退化超过 τ。 */
  degrade: () => boolean;
}

const CASES: GateCase[] = [
  {
    name: "contextMode",
    atZero: () =>
      contextModeStrictImprovementGate(
        { acceptanceInBudget: 0.5, redoRate: 0.3, isBaseline: false },
        { acceptanceInBudget: 0.5, redoRate: 0.3, isBaseline: true },
        TAU,
      ),
    strictImprove: () =>
      contextModeStrictImprovementGate(
        { acceptanceInBudget: 0.6, redoRate: 0.2, isBaseline: false },
        { acceptanceInBudget: 0.5, redoRate: 0.3, isBaseline: true },
        TAU,
      ),
    degrade: () =>
      contextModeStrictImprovementGate(
        { acceptanceInBudget: 0.4, redoRate: 0.3, isBaseline: false },
        { acceptanceInBudget: 0.5, redoRate: 0.3, isBaseline: true },
        TAU,
      ),
  },
  {
    name: "reducer",
    atZero: () =>
      reducerStrictImprovementGate(
        { mergeConsistency: 0.9, partitionDisjointRate: 0.9 } as never,
        { mergeConsistency: 0.9, partitionDisjointRate: 0.9 } as never,
        TAU,
      ),
    strictImprove: () =>
      reducerStrictImprovementGate(
        { mergeConsistency: 1.0, partitionDisjointRate: 0.95 } as never,
        { mergeConsistency: 0.9, partitionDisjointRate: 0.9 } as never,
        TAU,
      ),
    degrade: () =>
      reducerStrictImprovementGate(
        { mergeConsistency: 0.8, partitionDisjointRate: 0.9 } as never,
        { mergeConsistency: 0.9, partitionDisjointRate: 0.9 } as never,
        TAU,
      ),
  },
  {
    name: "delegation",
    atZero: () => delegationGate(0.5, 0.3, 0.5, 0.3),
    strictImprove: () => delegationGate(0.6, 0.2, 0.5, 0.3),
    degrade: () => delegationGate(0.4, 0.3, 0.5, 0.3),
  },
  {
    name: "recovery",
    atZero: () =>
      recoveryStrictImprovementGate(
        { postRecoveryAcceptance: 0.5, idempotencyIncidentCount: 0, isBaseline: false },
        { postRecoveryAcceptance: 0.5, idempotencyIncidentCount: 0, isBaseline: true },
        TAU,
      ),
    strictImprove: () =>
      recoveryStrictImprovementGate(
        { postRecoveryAcceptance: 0.6, idempotencyIncidentCount: 0, isBaseline: false },
        { postRecoveryAcceptance: 0.5, idempotencyIncidentCount: 0, isBaseline: true },
        TAU,
      ),
    degrade: () =>
      recoveryStrictImprovementGate(
        { postRecoveryAcceptance: 0.4, idempotencyIncidentCount: 0, isBaseline: false },
        { postRecoveryAcceptance: 0.5, idempotencyIncidentCount: 0, isBaseline: true },
        TAU,
      ),
  },
  {
    name: "hook",
    atZero: () =>
      hookStrictImprovementGate(
        { attackSuccessRate: 0.1, falseDenyRate: 0.1, isBaseline: false },
        { attackSuccessRate: 0.1, falseDenyRate: 0.1, isBaseline: true },
      ),
    strictImprove: () =>
      hookStrictImprovementGate(
        { attackSuccessRate: 0.05, falseDenyRate: 0.1, isBaseline: false },
        { attackSuccessRate: 0.1, falseDenyRate: 0.1, isBaseline: true },
      ),
    degrade: () =>
      hookStrictImprovementGate(
        { attackSuccessRate: 0.2, falseDenyRate: 0.1, isBaseline: false },
        { attackSuccessRate: 0.1, falseDenyRate: 0.1, isBaseline: true },
      ),
  },
  {
    name: "steering",
    atZero: () =>
      steeringStrictImprovementGate(
        { adoptionRate: 0.5, falseRejectRate: 0.1, isBaseline: false },
        { adoptionRate: 0.5, falseRejectRate: 0.1, isBaseline: true },
        TAU,
      ),
    strictImprove: () =>
      steeringStrictImprovementGate(
        { adoptionRate: 0.6, falseRejectRate: 0.1, isBaseline: false },
        { adoptionRate: 0.5, falseRejectRate: 0.1, isBaseline: true },
        TAU,
      ),
    degrade: () =>
      steeringStrictImprovementGate(
        { adoptionRate: 0.4, falseRejectRate: 0.1, isBaseline: false },
        { adoptionRate: 0.5, falseRejectRate: 0.1, isBaseline: true },
        TAU,
      ),
  },
];

/** delegation 门经实例方法调用（Δ 由参数对表达）。 */
function delegationGate(
  candAcceptance: number,
  candRedispatch: number,
  baseAcceptance: number,
  baseRedispatch: number,
): boolean {
  const sub = new DelegationSubstrate({} as never);
  return (
    sub.strictImprovementGate?.(
      { acceptanceRate: candAcceptance, reDispatchRate: candRedispatch } as never,
      { acceptanceRate: baseAcceptance, reDispatchRate: baseRedispatch } as never,
      TAU,
    ) ?? true
  );
}

describe("ISS-17 · strict-improvement 门语义一致性（6 处）", () => {
  it.each(CASES)("$name 门：Δ=0（完全无变化）必须 reject", ({ atZero }) => {
    expect(atZero()).toBe(false);
  });

  it.each(CASES)("$name 门：至少一项严格改善且不劣化 → accept", ({ strictImprove }) => {
    expect(strictImprove()).toBe(true);
  });

  it.each(CASES)("$name 门：任一项退化超 τ → reject", ({ degrade }) => {
    expect(degrade()).toBe(false);
  });
});
