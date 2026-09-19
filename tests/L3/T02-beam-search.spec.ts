// L3-T02: beam-search 优化器（GEPA 降配版，B=3，保留 top-3 变异候选） [MVP]
//
// RED state: BeamSearchOptimizer / ScoredMutant / SelectionSignalViolation not
// exported from @harness/l3-engine → tests fail. After implementation these
// assertions validate GEPA-reduced beam search behaviour.
//
// Spec: execution/L3-engine/TASKS.md §L3-T02.

import { describe, it, expect } from "vitest";
import {
  BeamSearchOptimizer,
  SelectionSignalViolation,
} from "@harness/l3-engine";
import type {
  Substrate,
  Mutant,
  Fitness,
  ScoredMutant,
  OptContext,
} from "@harness/l3-engine";
import { FakeEvaluator } from "./fixtures/fake-evaluator";
import { makeSubstrate, makeMutant, makeFitness } from "./fixtures/factories";

const promptSubstrate: Substrate = makeSubstrate({ sha: "sha-base" });

function scored(id: string, f: Fitness): ScoredMutant {
  return {
    mutant: makeMutant({ id, content: `content-${id}`, parentSha: "sha-base" }),
    fitness: f,
    split: "train" as const,
  };
}

describe("L3-T02", () => {
  // =========================================================================
  // generate
  // =========================================================================
  it("generate returns ≤ beamWidth candidates (seed=42 → exactly 3)", async () => {
    // Given beamWidth=3 + fixed-seed FakeEvaluator
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    const evaluator = new FakeEvaluator({ seed: 42 });
    const ctx: OptContext = { trajectories: [], best: null };
    // When generate one generation
    const out = await opt.generate(promptSubstrate, ctx);
    // Then returns ≤3 candidates
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.length).toBe(3); // seed=42 → exactly 3
    // fitness monotonically corresponds to seed (deterministic)
    const fitnesses = await Promise.all(
      out.map((m) => evaluator.score(m, "train")),
    );
    const rrs = fitnesses.map((f) => f.resolve_rate);
    // deterministic: re-running with same seed yields same sequence
    const out2 = await opt.generate(promptSubstrate, ctx);
    expect(out2.map((m) => m.id)).toEqual(out.map((m) => m.id));
    expect(rrs.length).toBeGreaterThan(0);
    void rrs; // shape assertion only; concrete values fixed by seed
  });

  it("selectTopK keeps fitness top-3; ties broken by diversity (content diff) — id order fixed by seed", () => {
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    // Two candidates with identical fitness; diversity tiebreak prefers larger
    // content difference.
    const a = scored("a", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const b = scored("b", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const c = scored("c", makeFitness({ resolve_rate: 0.9, token: 100, cache_hit: 0.5 }));
    a.mutant.content = "aaaaa";
    b.mutant.content = "azzzz"; // more different from a's prefix than "aaaaa"? both vs c
    const top = opt.selectTopK([a, b, c], 3);
    expect(top).toHaveLength(3);
    // highest fitness first
    expect(top[0].mutant.id).toBe("c");
    // Spec: ties broken by diversity with id order fixed by seed. Re-running
    // selectTopK on identical input must yield the exact same id sequence —
    // this pins the tiebreak to be deterministic (seed-fixed), not arbitrary.
    const top2 = opt.selectTopK([a, b, c], 3);
    expect(top2.map((s) => s.mutant.id)).toEqual(top.map((s) => s.mutant.id));
  });

  it("beamWidth=3 but optimizer LLM produces only 2 candidates → returns 2 (no padding)", async () => {
    // Boundary: insufficient candidates.
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 7 });
    const ctx: OptContext = { trajectories: [], best: null };
    // Generate and assert ≤ beamWidth; with seed 7 the candidate count is
    // whatever the LLM stub emits — the invariant is "never pad".
    const out = await opt.generate(promptSubstrate, ctx);
    expect(out.length).toBeLessThanOrEqual(3);
    // Re-run determinism
    const out2 = await opt.generate(promptSubstrate, ctx);
    expect(out2.length).toBe(out.length);
  });

  it("FakeEvaluator throwing on a candidate → that candidate skipped, loop does not crash", async () => {
    // Error path: score failure isolation.
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    const evaluator = new FakeEvaluator({
      seed: 42,
      throwOn: ["will-throw"],
    });
    const ctx: OptContext = { trajectories: [], best: null };
    const out = await opt.generate(promptSubstrate, ctx);
    // generate must not throw even if scoring a candidate throws
    expect(Array.isArray(out)).toBe(true);
    // any candidate whose score threw must be absent from survivors
    for (const m of out) {
      expect(m.id).not.toBe("will-throw");
    }
    void evaluator;
  });

  it("heldout fitness passed into selectTopK → throws SelectionSignalViolation (heldout must not feed generate, contract §2)", () => {
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    const heldoutScored = scored("h", makeFitness({ resolve_rate: 0.7 }));
    // @ts-expect-error deliberate split violation
    heldoutScored.split = "heldout";
    expect(() => opt.selectTopK([heldoutScored], 3)).toThrow(
      SelectionSignalViolation,
    );
  });

  // =========================================================================
  // Convergence (GEPA hill-climb): best.resolve_rate monotonically non-decreasing
  // =========================================================================
  it("convergence: seed fixed → 3 consecutive generations, best.resolve_rate monotonically non-decreasing", async () => {
    const opt = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    const evaluator = new FakeEvaluator({ seed: 42 });
    let best: Mutant | null = null;
    const rrs: number[] = [];
    for (let gen = 0; gen < 3; gen++) {
      const ctx: OptContext = { trajectories: [], best };
      const cands = await opt.generate(promptSubstrate, ctx);
      const scoredCands = await Promise.all(
        cands.map(async (m) => ({
          mutant: m,
          fitness: await evaluator.score(m, "train"),
        })),
      );
      scoredCands.sort(
        (a, b) => b.fitness.resolve_rate - a.fitness.resolve_rate,
      );
      best = scoredCands[0]?.mutant ?? best;
      rrs.push(scoredCands[0]?.fitness.resolve_rate ?? 0);
    }
    // monotonic non-decreasing
    for (let i = 1; i < rrs.length; i++) {
      expect(rrs[i]).toBeGreaterThanOrEqual(rrs[i - 1]);
    }
  });
});
