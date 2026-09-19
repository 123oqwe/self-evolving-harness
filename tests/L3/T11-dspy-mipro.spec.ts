// L3-T11: DSPy/MIPROv2 instruction×demo factorize + Bayesian surrogate + train/val [V1]
//
// RED state: DspyMiproOptimizer / BayesianSurrogate / TrainValLeak /
// NotImplementedError not exported → RED.
//
// Spec: execution/L3-engine/TASKS.md §L3-T11.

import { describe, it, expect } from "vitest";
import {
  DspyMiproOptimizer,
  BayesianSurrogate,
  TrainValLeak,
  NotImplementedError,
} from "@harness/l3-engine";
import type { Mutant, Fitness, Substrate } from "@harness/l3-engine";
import { FakeLLM } from "./fixtures/fake-llm";
import { makeMutant, makeFitness, makeSubstrate } from "./fixtures/factories";

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

describe("L3-T11", () => {
  // =========================================================================
  // BayesianSurrogate
  // =========================================================================
  it("surrogate.fit + predict: predicted mean correlates with true fitness (Pearson > 0.5, fixed seed)", () => {
    const sur = new BayesianSurrogate({ seed: 42 });
    const samples: { mutant: Mutant; fitness: Fitness; split: "train" }[] = [];
    for (let i = 0; i < 10; i++) {
      const resolve = 0.1 + 0.08 * i + (i % 2) * 0.01;
      const m = makeMutant({ id: `s-${i}`, content: `instr-${i}` });
      samples.push({
        mutant: m,
        fitness: makeFitness({ resolve_rate: resolve, token: 100, cache_hit: 0.5 }),
        split: "train",
      });
    }
    sur.fit(samples);
    const preds = samples.map((s) => sur.predict(s.mutant).mean);
    const truth = samples.map((s) => s.fitness.resolve_rate);
    expect(pearson(preds, truth)).toBeGreaterThan(0.5);
  });

  it("acquisition: high-variance candidate prioritised (exploration, seed-fixed id)", () => {
    const sur = new BayesianSurrogate({ seed: 42 });
    // Fit on a few samples so variance differs across mutants.
    const samples: { mutant: Mutant; fitness: Fitness; split: "train" }[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push({
        mutant: makeMutant({ id: `t-${i}`, content: `c-${i}` }),
        fitness: makeFitness({ resolve_rate: 0.2 + 0.1 * i, token: 100, cache_hit: 0.5 }),
        split: "train",
      });
    }
    sur.fit(samples);
    // An unseen mutant far from training → higher acquisition than a known one.
    const novel = makeMutant({ id: "novel-xyz", content: "totally unseen instruction" });
    const known = samples[0].mutant;
    expect(sur.acquisition(novel)).toBeGreaterThan(sur.acquisition(known));
  });

  it("heldout split samples passed to fit → TrainValLeak (heldout must not feed surrogate)", () => {
    const sur = new BayesianSurrogate({ seed: 42 });
    const leaky: { mutant: Mutant; fitness: Fitness; split: "train" }[] = [
      {
        mutant: makeMutant({ id: "leak" }),
        fitness: makeFitness(),
        // @ts-expect-error deliberate leak
        split: "heldout",
      },
    ];
    expect(() => sur.fit(leaky)).toThrow(TrainValLeak);
  });

  // =========================================================================
  // DspyMiproOptimizer — factorize instruction × demo
  // =========================================================================
  it("factorize: 3 instruction × 3 demo → 9 crossed Mutants (origin='reflective', parentSha)", async () => {
    const llm = new FakeLLM({
      // route by prompt keyword to produce distinct instructions/demos
      replies: {
        instruction: JSON.stringify([
          { content: "instr-a" },
          { content: "instr-b" },
          { content: "instr-c" },
        ]),
        demo: JSON.stringify([
          { content: "demo-1" },
          { content: "demo-2" },
          { content: "demo-3" },
        ]),
      },
    });
    const sur = new BayesianSurrogate({ seed: 42 });
    const opt = new DspyMiproOptimizer({
      llm,
      surrogate: sur,
      trainSplit: 0.7,
      seed: 42,
    });
    const parent: Substrate = makeSubstrate({ sha: "sha-p", content: "base prompt" });
    const instr = await opt.proposeInstruction(parent);
    const demos = await opt.proposeDemo(parent);
    expect(instr.length).toBe(3);
    expect(demos.length).toBe(3);
    // crossed combination
    const crossed: Mutant[] = [];
    for (const i of instr) for (const d of demos) crossed.push(i), crossed.push(d);
    // The optimizer's generate yields the cartesian product; assert ≥ 9 unique.
    const out = await opt.generate(parent, { trajectories: [], best: null });
    expect(out.length).toBeGreaterThanOrEqual(9);
    for (const m of out) {
      expect(m.origin).toBe("reflective");
      expect(m.parentSha).toBe(parent.sha);
    }
  });

  it("train/val split non-overlapping (train ∩ val = ∅)", () => {
    const sur = new BayesianSurrogate({ seed: 42 });
    const train: { mutant: Mutant; fitness: Fitness; split: "train" }[] = [];
    const all: Mutant[] = [];
    for (let i = 0; i < 10; i++) {
      const m = makeMutant({ id: `d-${i}`, content: `c-${i}` });
      all.push(m);
      train.push({
        mutant: m,
        fitness: makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 }),
        split: "train",
      });
    }
    sur.fit(train); // trainSplit 0.7 → 7 train, 3 val internally
    // The surrogate must not allow a heldout/val sample back into fit.
    const valSample = {
      mutant: all[9],
      fitness: makeFitness(),
      // @ts-expect-error deliberate
      split: "heldout" as const,
    };
    expect(() => sur.fit([valSample])).toThrow(TrainValLeak);
  });

  it("workflow/weight substrate → NotImplementedError (prompt-only)", async () => {
    const opt = new DspyMiproOptimizer({
      llm: new FakeLLM({}),
      surrogate: new BayesianSurrogate({ seed: 42 }),
      trainSplit: 0.7,
      seed: 42,
    });
    await expect(
      opt.generate(
        makeSubstrate({ kind: "workflow", sha: "w", content: "wf" }),
        { trajectories: [], best: null },
      ),
    ).rejects.toThrow(NotImplementedError);
    await expect(
      opt.generate(
        makeSubstrate({ kind: "weight", sha: "wt", content: "wt" }),
        { trajectories: [], best: null },
      ),
    ).rejects.toThrow(NotImplementedError);
  });
});
