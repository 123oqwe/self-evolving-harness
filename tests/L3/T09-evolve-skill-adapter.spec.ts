// L3-T09: evolve-skill/skill-creator 适配层 + fitness 泛化 + 模块集成测试 [MVP]
//
// RED state: EvolveSkillAdapter / FitnessBridge / FitnessGeneralizationError /
// LoopResult / runEvolutionLoop not exported → RED. After implementation these
// validate the closed loop + telemetry→fitness generalisation.
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 + §1 (module-level integration).
//
// NOTE: §1 pseudocode uses `@self/l3-engine` and `committed.versionSuffix`; the
// actual package name is `@harness/l3-engine` and the T08/T09 contract returns
// `committed.version` (not `versionSuffix`). See structured ambiguities.

import { describe, it, expect, vi } from "vitest";
import {
  runEvolutionLoop,
  FitnessBridge,
  FitnessGeneralizationError,
  IncompleteTelemetry,
} from "@harness/l3-engine";
import type { Substrate, Fitness } from "@harness/l3-engine";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { FakeEvaluator, SEED_FIXTURE } from "./fixtures/fake-evaluator";
import { makeSubstrate } from "./fixtures/factories";

describe("L3-T09", () => {
  // =========================================================================
  // FitnessBridge — telemetry → Fitness generalisation
  // =========================================================================
  it("fromTelemetry: span {pass:true, usage:{output:100}, cache_read:80} → Fitness={resolve_rate:1, token:100, cache_hit:0.8}", () => {
    const bridge = new FitnessBridge();
    const f: Fitness = bridge.fromTelemetry({
      gen_ai_evaluation: { pass: true },
      usage: { output: 100 },
      cache_read: 80,
    });
    expect(f.resolve_rate).toBe(1);
    expect(f.token).toBe(100);
    expect(f.cache_hit).toBe(0.8);
  });

  it("fromTelemetry: span missing usage → throws IncompleteTelemetry", () => {
    const bridge = new FitnessBridge();
    expect(() =>
      bridge.fromTelemetry({ gen_ai_evaluation: { pass: true }, cache_read: 80 }),
    ).toThrow(IncompleteTelemetry);
  });

  it("fromTelemetry: pass=false → resolve_rate=0 (failure path)", () => {
    const bridge = new FitnessBridge();
    const f = bridge.fromTelemetry({
      gen_ai_evaluation: { pass: false },
      usage: { output: 50 },
      cache_read: 0,
    });
    expect(f.resolve_rate).toBe(0);
  });

  // =========================================================================
  // runEvolutionLoop — closed loop (improve + regress)
  // =========================================================================
  it("runLoop: improver commits + enters archive; regressor rejected (§1 scenario one)", async () => {
    const evaluator = new FakeEvaluator(SEED_FIXTURE);
    const result = await runEvolutionLoop({
      substrate: makeSubstrate({ kind: "prompt", content: "baseline prompt", sha: "abc" }),
      beamWidth: 3,
      evaluator,
      sandbox: new FakeSandbox(),
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
      generations: 2,
    });
    // only the improver enters the archive
    expect(result.archive.size()).toBe(1);
    expect(result.rejected).toHaveLength(1);
    // committed version bumped to V2
    expect(result.committed).not.toBeNull();
    expect(result.committed?.version).toMatch(/V2$/);
  });

  it("runLoop: breaker scenario — optimizer writes static-core → reject + securityEvent (§1 scenario two)", async () => {
    const sandbox = new FakeSandbox({ attemptWrite: "packages/l0-core/x" });
    await expect(
      runEvolutionLoop({
        substrate: makeSubstrate({ sha: "abc" }),
        beamWidth: 3,
        evaluator: new FakeEvaluator(SEED_FIXTURE),
        sandbox,
        tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
        generations: 1,
      }),
    ).rejects.toThrow();
    expect(sandbox.log.securityEvents).toHaveLength(1);
  });

  it("fitness generalisation error: raw skill pass@k semantics leak → FitnessGeneralizationError", () => {
    // The adapter must reject a Fitness whose raw carries the original
    // evolve-skill "skillPassAtK" metric without generalisation to
    // resolve_rate/token/cache_hit.
    const bridge = new FitnessBridge();
    // A span that would otherwise be valid (pass + usage + cache_read) but
    // smuggles the raw skill pass@k metric — the bridge must reject it
    // rather than silently using the un-generalised skill metric.
    expect(() =>
      bridge.fromTelemetry({
        gen_ai_evaluation: { pass: true },
        usage: { output: 100 },
        cache_read: 80,
        // @ts-expect-error deliberate raw-metric smuggling
        skillPassAtK: 0.8,
      }),
    ).toThrow(FitnessGeneralizationError);
  });
});
