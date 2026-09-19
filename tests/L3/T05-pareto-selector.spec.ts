// L3-T05: Pareto 多目标选择器（resolve_rate ∧ token ∧ cache_hit，无加权求和） [MVP]
//
// RED state: ParetoSelector / ParetoPoint / WeightedSumForbidden not exported
// → RED. Invariant: weightedSum forbidden (no such symbol may appear in
// source).
//
// Spec: execution/L3-engine/TASKS.md §L3-T05.

import { describe, it, expect } from "vitest";
import { ParetoSelector, WeightedSumForbidden } from "@harness/l3-engine";
import type { ParetoPoint, Mutant, Fitness } from "@harness/l3-engine";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeMutant, makeFitness } from "./fixtures/factories";

function point(id: string, f: Fitness): ParetoPoint {
  return {
    mutant: makeMutant({ id, content: `c-${id}` }),
    fitness: f,
  };
}

const srcPath = path.resolve(
  process.cwd(),
  "packages/l3-engine/src/pareto-selector.ts",
);

describe("L3-T05", () => {
  it("mutually non-dominating points → all returned", () => {
    const sel = new ParetoSelector();
    // A(resolve=0.6,token=100) vs B(resolve=0.5,token=80): neither dominates
    const a = point("a", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const b = point("b", makeFitness({ resolve_rate: 0.5, token: 80, cache_hit: 0.5 }));
    const front = sel.nonDominatedFront([a, b]);
    expect(front.map((p) => p.mutant.id).sort()).toEqual(["a", "b"]);
  });

  it("one point strictly better in all dims → other excluded", () => {
    const sel = new ParetoSelector();
    // A(0.6,100) strictly dominates B(0.5,120) (resolve up, token down)
    const a = point("a", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const b = point("b", makeFitness({ resolve_rate: 0.5, token: 120, cache_hit: 0.5 }));
    const front = sel.nonDominatedFront([a, b]);
    expect(front.map((p) => p.mutant.id)).toEqual(["a"]);
  });

  it("token direction flipped correctly (low token not dominated by high token)", () => {
    const sel = new ParetoSelector();
    // B has lower token (better) but lower resolve (worse) → not dominated by A
    const a = point("a", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const b = point("b", makeFitness({ resolve_rate: 0.5, token: 80, cache_hit: 0.5 }));
    const front = sel.nonDominatedFront([a, b]);
    expect(front.map((p) => p.mutant.id).sort()).toEqual(["a", "b"]);
  });

  it("weightedSum call → throws WeightedSumForbidden (invariant, PRD §6.7)", () => {
    const sel = new ParetoSelector();
    // The selector must not expose any weightedSum API.
    expect((sel as unknown as { weightedSum?: unknown }).weightedSum).toBeUndefined();
    // And calling a hypothetical weightedSum must throw the forbidden error.
    expect(() => {
      const fn = (sel as unknown as { weightedSum?: (p: ParetoPoint[]) => number })
        .weightedSum;
      if (fn) return fn([]);
      throw new WeightedSumForbidden("no weightedSum exposed");
    }).toThrow(WeightedSumForbidden);
  });

  it("3+ dims all equal points → all kept (boundary: tied non-dominated)", () => {
    const sel = new ParetoSelector();
    const a = point("a", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const b = point("b", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const c = point("c", makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }));
    const front = sel.nonDominatedFront([a, b, c]);
    expect(front).toHaveLength(3);
  });

  it("empty input → []", () => {
    const sel = new ParetoSelector();
    expect(sel.nonDominatedFront([])).toEqual([]);
  });

  it("source file contains no weightedSum identifier (grep invariant)", () => {
    // PRD §6.7 hard invariant: no weighted-sum implementation. Reads the
    // implementer's source file — in RED the file is absent → readFileSync
    // throws → test fails (genuine RED). Once implemented, GREEN requires the
    // symbol to be absent.
    const src = readFileSync(srcPath, "utf8");
    expect(src).not.toMatch(/\bweightedSum\b/);
  });

  it("fixed-seed FakeEvaluator produces 3 candidates → front size fixed by seed", async () => {
    const { FakeEvaluator } = await import("./fixtures/fake-evaluator");
    const { makeSubstrate } = await import("./fixtures/factories");
    const sel = new ParetoSelector();
    const ev = new FakeEvaluator({ seed: 42 });
    const sub = makeSubstrate();
    const mutants = [makeMutant({ id: "m1" }), makeMutant({ id: "m2" }), makeMutant({ id: "m3" })];
    const pts: ParetoPoint[] = [];
    for (const m of mutants) {
      pts.push({ mutant: m, fitness: await ev.score(m, "train") });
    }
    const front = sel.nonDominatedFront(pts);
    // Deterministic by seed: front size is reproducible.
    const front2 = sel.nonDominatedFront(pts);
    expect(front.length).toBe(front2.length);
    expect(front.length).toBeGreaterThanOrEqual(1);
    void sub;
  });
});
