// L3 — 模块级集成测试 (§1)
//
// RED state: runEvolutionLoop not implemented → RED. These two scenarios are
// the L3 module gate (G3): strict-improvement rejects regressing variants;
// breaker rejects static-core writes.
//
// Spec: execution/L3-engine/TASKS.md §1.
//
// NOTE on ambiguity: §1 pseudocode imports from `@self/l3-engine` and asserts
// `committed.versionSuffix`; the actual package name is `@harness/l3-engine`
// and the T08/T09 contract returns `committed.version` (no `versionSuffix`
// field). These tests follow the more explicit T08/T09 contract.

import { describe, it, expect } from "vitest";
import { runEvolutionLoop } from "@harness/l3-engine";
import { FakeEvaluator, SEED_FIXTURE } from "./fixtures/fake-evaluator";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { makeSubstrate } from "./fixtures/factories";

describe("L3-integration", () => {
  it("scenario one: regressing variant rejected by strict-improvement and not archived", async () => {
    const evaluator = new FakeEvaluator(SEED_FIXTURE);
    // SEED_FIXTURE: 1st variant improves, 2nd regresses (resolve_rate -10pp).
    const result = await runEvolutionLoop({
      substrate: makeSubstrate({
        kind: "prompt",
        content: "baseline prompt",
        sha: "abc",
      }),
      beamWidth: 3,
      evaluator,
      sandbox: new FakeSandbox(),
      tau: { resolve_rate: 0.0, token: 0.0, cache_hit: 0.0 },
      generations: 2,
    });

    // Only the improver is archived.
    expect(result.archive.size()).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.committed?.version).toMatch(/V2$/);
  });

  it("scenario two: optimizer writes static-core path → reject + securityEvent", async () => {
    const sandbox = new FakeSandbox({ attemptWrite: "packages/l0-core/x" });
    await expect(
      runEvolutionLoop({
        substrate: makeSubstrate({ kind: "prompt", content: "p", sha: "abc" }),
        beamWidth: 3,
        evaluator: new FakeEvaluator(SEED_FIXTURE),
        sandbox,
        tau: { resolve_rate: 0.0, token: 0.0, cache_hit: 0.0 },
        generations: 1,
      }),
    ).rejects.toThrow(/breaker.*static-core/i);
    expect(sandbox.log.securityEvents).toHaveLength(1);
  });
});
