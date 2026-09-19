// L3-T01: 优化器路由器 + 引擎沙箱入口 + breaker clause [MVP]
//
// RED state: @harness/l3-engine is a placeholder (`export {}`); named exports
// `routeOptimizer`, `runEvolutionLoop`, `STATIC_CORE_PATHS`, `BreakerError`,
// `NotImplemented` are undefined at runtime → tests fail (legitimate RED).
// Once implemented, every assertion below validates real behaviour.
//
// Spec: execution/L3-engine/TASKS.md §L3-T01.

import { describe, it, expect } from "vitest";
import {
  routeOptimizer,
  runEvolutionLoop,
  STATIC_CORE_PATHS,
  BreakerError,
  NotImplemented,
} from "@harness/l3-engine";
import type {
  Substrate,
  Sandbox,
  Evaluator,
  Mutant,
  Fitness,
  Optimizer,
} from "@harness/l3-engine";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { FakeEvaluator, SEED_FIXTURE } from "./fixtures/fake-evaluator";
import { makeSubstrate, makeMutant, makeFitness } from "./fixtures/factories";

const promptSubstrate: Substrate = makeSubstrate({ kind: "prompt", sha: "abc" });

describe("L3-T01", () => {
  // =========================================================================
  // routeOptimizer
  // =========================================================================
  it("routeOptimizer('prompt') returns a non-null Optimizer instance (stub OK, assert interface shape)", async () => {
    // Given substrate.kind='prompt'
    // When routeOptimizer
    const opt = routeOptimizer("prompt");
    // Then returns non-null Optimizer with a generate function
    expect(opt).not.toBeNull();
    expect(typeof (opt as Optimizer).generate).toBe("function");
  });

  it("routeOptimizer('weight') returns null (weight channel default off invariant)", () => {
    // Given substrate.kind='weight'
    // When routeOptimizer
    // Then null — weight channel off by default (PRD §6.1 N1)
    expect(routeOptimizer("weight")).toBeNull();
  });

  it("routeOptimizer('workflow') throws NotImplemented (V2 placeholder, MVP unsupported)", () => {
    // Given substrate.kind='workflow' (V2)
    // When routeOptimizer
    // Then throws NotImplemented (existence guard ensures genuine RED —
    // calling an undefined binding must not satisfy this assertion).
    expect(typeof routeOptimizer).toBe("function");
    expect(() => routeOptimizer("workflow")).toThrow(NotImplemented);
  });

  // =========================================================================
  // STATIC_CORE_PATHS (mirrors L0C-T11 STATIC_CORE_DIRS)
  // =========================================================================
  it("STATIC_CORE_PATHS mirrors L0C-T11 STATIC_CORE_DIRS (shared constant, not redefined)", async () => {
    const { STATIC_CORE_DIRS } = await import("@harness/l0-core");
    expect(STATIC_CORE_PATHS).toEqual([...STATIC_CORE_DIRS]);
    // critical: must contain the verifier src path with /src/ prefix
    expect(STATIC_CORE_PATHS).toContain("packages/canary-eval/src/verifier");
  });

  // =========================================================================
  // runEvolutionLoop entry — breaker on static-core writable
  // =========================================================================
  it("runEvolutionLoop entry: static-core writable → throws BreakerError + securityEvents length=1", async () => {
    // Given static-core path writable (assertReadonly fails)
    const sandbox = new FakeSandbox({ attemptWrite: "packages/l0-core/x" });
    const evaluator = new FakeEvaluator(SEED_FIXTURE);
    // When runEvolutionLoop entry
    // Then throws BreakerError + a securityEvent is recorded
    await expect(
      runEvolutionLoop({
        substrate: promptSubstrate,
        beamWidth: 3,
        evaluator,
        sandbox,
        tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
        generations: 2,
      }),
    ).rejects.toThrow(BreakerError);
    expect(sandbox.log.securityEvents).toHaveLength(1);
  });

  it("runEvolutionLoop entry: assertReadonly invoked with STATIC_CORE_PATHS", async () => {
    // The breaker must assert readonly on the canonical static-core set at entry.
    const sandbox = new FakeSandbox({ attemptWrite: "packages/l0-core/x" });
    const evaluator = new FakeEvaluator(SEED_FIXTURE);
    await expect(
      runEvolutionLoop({
        substrate: promptSubstrate,
        beamWidth: 3,
        evaluator,
        sandbox,
        tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
        generations: 1,
      }),
    ).rejects.toThrow();
    expect(sandbox.assertReadonlyCalls.length).toBeGreaterThan(0);
    const asserted = sandbox.assertReadonlyCalls[0];
    for (const p of STATIC_CORE_PATHS) {
      expect(asserted).toContain(p);
    }
  });

  it("weight channel stays off across repeated calls (no public toggle exists; route table immutable)", () => {
    // Given the route table is frozen and weight channel is off by default
    expect(routeOptimizer("weight")).toBeNull();
    // When routeOptimizer is called repeatedly (no public off→on toggle exists)
    // Then the weight channel is never enabled — the route table is immutable
    // through the public contract (REFACTOR: ReadonlyMap + Object.freeze).
    for (let i = 0; i < 5; i++) {
      expect(routeOptimizer("weight")).toBeNull();
    }
    // No public setter is exposed to flip the channel on at runtime.
    const router = routeOptimizer as unknown as Record<string, unknown>;
    expect(router.setEnabled).toBeUndefined();
    expect(router.set).toBeUndefined();
    expect(router.enable).toBeUndefined();
  });
});
