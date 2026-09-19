// L1-T19 · failure recovery policy + 幂等 checklist 进化（super-step+node 幂等 static-core）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T19 spec 编写。

import { describe, it, expect } from "vitest";
import {
  FailureRecovery,
  IdempotencyIncidentError,
  CheckpointLocationError,
  type RecoveryRule,
  type RecoveryScore,
} from "@harness/l1-config";

function rscore(o: Partial<RecoveryScore>): RecoveryScore {
  return {
    postRecoveryAcceptance: o.postRecoveryAcceptance ?? 0.5,
    idempotencyIncidentCount: o.idempotencyIncidentCount ?? 0,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T19", () => {
  it("evolve adjusts action on misclassified failure", () => {
    const e = new FailureRecovery();
    // baseline: 该 retry 却 reroute
    const rules: RecoveryRule[] = [{ failureSignature: "timeout", action: "reroute", maxRetries: 0, rerouteTarget: "other" }];
    const baseline = rscore({ isBaseline: true, postRecoveryAcceptance: 0.3, idempotencyIncidentCount: 0 });
    const evolved = e.evolve(rules, "checklist", [baseline]);
    const timeout = evolved.rules.find((r) => r.failureSignature === "timeout");
    expect(timeout).toBeDefined();
    expect(timeout!.action).not.toBe("reroute");
  });

  it("assertIdempotencyZero throws when count > 0", () => {
    const e = new FailureRecovery();
    expect(() => e.assertIdempotencyZero(rscore({ idempotencyIncidentCount: 1 }))).toThrowError(IdempotencyIncidentError);
  });

  it("assertIdempotencyZero passes when count == 0", () => {
    const e = new FailureRecovery();
    expect(() => e.assertIdempotencyZero(rscore({ idempotencyIncidentCount: 0 }))).not.toThrow();
  });

  it("assertCheckpointAtSuperStep throws on node-internal checkpoint", () => {
    const e = new FailureRecovery();
    expect(() => e.assertCheckpointAtSuperStep("node-internal")).toThrowError(CheckpointLocationError);
    expect(() => e.assertCheckpointAtSuperStep("super-step")).not.toThrow();
  });

  it("strict-improvement: acceptance↑ ∧ idempotency==0 → 入选", () => {
    const e = new FailureRecovery();
    const rules: RecoveryRule[] = [{ failureSignature: "timeout", action: "retry", maxRetries: 2 }];
    const baseline = rscore({ isBaseline: true, postRecoveryAcceptance: 0.4, idempotencyIncidentCount: 0 });
    const cand = rscore({ postRecoveryAcceptance: 0.6, idempotencyIncidentCount: 0 });
    const evolved = e.evolve(rules, "checklist", [baseline, cand]);
    expect(evolved.rules.length).toBeGreaterThan(0);
  });
});
