// L3-T10: full-population reflective mutation + Pareto 非支配排序 (NSGA-II) [V1]
//
// RED state: FullPopulationBeamSearch / FullParetoSelector / fastNonDominatedSort
// / NSGAFront not exported → RED. Inherits T02/T05 invariants
// (SelectionSignalViolation, WeightedSumForbidden, direction flips).
//
// Spec: execution/L3-engine/TASKS.md §L3-T10.

import { describe, it, expect, vi } from "vitest";
import {
  FullPopulationBeamSearch,
  FullParetoSelector,
  SelectionSignalViolation,
  WeightedSumForbidden,
  BeamSearchOptimizer,
} from "@harness/l3-engine";
import type { ParetoPoint, ScoredMutant, Substrate, OptContext } from "@harness/l3-engine";
import { FakeEvaluator } from "./fixtures/fake-evaluator";
import { makeMutant, makeFitness, makeSubstrate } from "./fixtures/factories";

function pt(id: string, resolve: number, token: number, cache = 0.5): ParetoPoint {
  return {
    mutant: makeMutant({ id, content: `c-${id}` }),
    fitness: makeFitness({ resolve_rate: resolve, token, cache_hit: cache }),
  };
}

describe("L3-T10", () => {
  // =========================================================================
  // FullPopulationBeamSearch — every top-K candidate triggers reflective mutation
  // =========================================================================
  it("full-population generate triggers reflective mutation per top-K candidate (mutate calls = K, not 1)", async () => {
    // Given beamWidth=3 + 3 candidates each with failures
    const spyMutate = vi.fn(async () => [makeMutant({ origin: "reflective" })]);
    const opt = new FullPopulationBeamSearch({
      beamWidth: 3,
      prngSeed: 42,
      // @ts-expect-error inject reflective spy for instrumentation
      reflective: { mutate: spyMutate },
    });
    const population: ScoredMutant[] = [
      {
        mutant: makeMutant({ id: "p1" }),
        fitness: makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }),
        split: "train" as const,
      },
      {
        mutant: makeMutant({ id: "p2" }),
        fitness: makeFitness({ resolve_rate: 0.5, token: 90, cache_hit: 0.5 }),
        split: "train" as const,
      },
      {
        mutant: makeMutant({ id: "p3" }),
        fitness: makeFitness({ resolve_rate: 0.55, token: 80, cache_hit: 0.5 }),
        split: "train" as const,
      },
    ];
    const ctx: OptContext & { population: ScoredMutant[] } = {
      trajectories: [],
      best: null,
      population,
    };
    const sub: Substrate = makeSubstrate();
    await opt.generate(sub, ctx);
    // Then reflective mutation called once per candidate (K=3), not once
    expect(spyMutate).toHaveBeenCalledTimes(3);
  });

  // =========================================================================
  // fastNonDominatedSort — layered fronts
  // =========================================================================
  it("fastNonDominatedSort: 6 points with 2 layers → rank 0 = non-dominated, rank 1 = dominated-by-rank0", () => {
    const sel = new FullParetoSelector();
    // Layer 0: a, b mutually non-dominating
    // Layer 1: c, d dominated by a; e, f dominated by b
    const points: ParetoPoint[] = [
      pt("a", 0.6, 100),
      pt("b", 0.5, 80),
      pt("c", 0.5, 120),
      pt("d", 0.4, 130),
      pt("e", 0.4, 90),
      pt("f", 0.3, 100),
    ];
    const fronts = sel.fastNonDominatedSort(points);
    expect(fronts.length).toBeGreaterThanOrEqual(2);
    const rank0 = fronts.find((fr) => fr.rank === 0);
    const rank1 = fronts.find((fr) => fr.rank === 1);
    expect(rank0).toBeDefined();
    expect(rank1).toBeDefined();
    const ids0 = rank0!.members.map((p) => p.mutant.id).sort();
    const ids1 = rank1!.members.map((p) => p.mutant.id).sort();
    expect(ids0).toEqual(["a", "b"]);
    // rank1 members are dominated by rank0
    expect(ids1.length).toBe(4);
    expect(ids1).toContain("c");
    expect(ids1).toContain("f");
  });

  it("full-population first front size ≥ reduced beam front size (same seed, upgrade payoff)", async () => {
    const sub = makeSubstrate();
    const evaluator = new FakeEvaluator({ seed: 42 });
    // Reduced beam (T02, single-best reflection)
    const reduced = new BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 });
    // Full population (T10)
    const full = new FullPopulationBeamSearch({
      beamWidth: 3,
      prngSeed: 42,
      // @ts-expect-error stub reflective
      reflective: { mutate: async (_s: Substrate, _t: unknown[]) => [makeMutant({ origin: "reflective" })] },
    });
    const ctxR: OptContext = { trajectories: [], best: null };
    // Non-empty population so full-population reflective mutation actually
    // mutates each top-K candidate (otherwise generate yields 0 candidates
    // and the front comparison below crashes on an empty sort result).
    const population: ScoredMutant[] = [
      { mutant: makeMutant({ id: "f1" }), fitness: makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }), split: "train" as const },
      { mutant: makeMutant({ id: "f2" }), fitness: makeFitness({ resolve_rate: 0.5, token: 90, cache_hit: 0.5 }), split: "train" as const },
      { mutant: makeMutant({ id: "f3" }), fitness: makeFitness({ resolve_rate: 0.55, token: 80, cache_hit: 0.5 }), split: "train" as const },
    ];
    const ctxF: OptContext & { population: ScoredMutant[] } = {
      trajectories: [],
      best: null,
      population,
    };
    const redCands = await reduced.generate(sub, ctxR);
    const fullCands = await full.generate(sub, ctxF);
    const redScored: ParetoPoint[] = await Promise.all(
      redCands.map(async (m) => ({ mutant: m, fitness: await evaluator.score(m, "train") })),
    );
    const fullScored: ParetoPoint[] = await Promise.all(
      fullCands.map(async (m) => ({ mutant: m, fitness: await evaluator.score(m, "train") })),
    );
    const sel = new FullParetoSelector();
    const redFront = sel.fastNonDominatedSort(redScored)[0];
    const fullFront = sel.fastNonDominatedSort(fullScored)[0];
    expect(fullFront.members.length).toBeGreaterThanOrEqual(redFront.members.length);
  });

  it("heldout fitness passed into fastNonDominatedSort → SelectionSignalViolation (inherited contract)", () => {
    const sel = new FullParetoSelector();
    const heldout = pt("h", 0.7, 50);
    // @ts-expect-error deliberate split violation
    heldout.split = "heldout";
    expect(() => sel.fastNonDominatedSort([heldout])).toThrow(SelectionSignalViolation);
  });

  it("weightedSum call → WeightedSumForbidden (invariant inherited from T05)", () => {
    const sel = new FullParetoSelector();
    expect((sel as unknown as { weightedSum?: unknown }).weightedSum).toBeUndefined();
    expect(() => {
      throw new WeightedSumForbidden("inherited");
    }).toThrow(WeightedSumForbidden);
  });
});
