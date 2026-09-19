// L3-T04: strict-improvement 硬门 [MVP]
//
// RED state: StrictImprovementGate / IncompleteFitness not exported → RED.
// Direction pins: resolve_rate/cache_hit higher=better (no flip); token
// lower=better (flipped). Four spec statements must stay aligned.
//
// Spec: execution/L3-engine/TASKS.md §L3-T04.

import { describe, it, expect } from "vitest";
import {
  StrictImprovementGate,
  IncompleteFitness,
} from "@harness/l3-engine";
import type { Fitness } from "@harness/l3-engine";
import { makeFitness } from "./fixtures/factories";

describe("L3-T04", () => {
  it("improvement → accept (resolve_rate up, token same, cache_hit same, τ=0)", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    const candidate = makeFitness({ resolve_rate: 0.55, token: 100, cache_hit: 0.5 });
    const v = gate.decide(baseline, candidate);
    expect(v.accept).toBe(true);
    expect(v.regressions).toEqual([]);
  });

  it("regression → reject + regressions=['resolve_rate'] (resolve_rate down 0.05 ≥ τ=0)", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    const candidate = makeFitness({ resolve_rate: 0.45, token: 100, cache_hit: 0.5 });
    const v = gate.decide(baseline, candidate);
    expect(v.accept).toBe(false);
    expect(v.regressions).toContain("resolve_rate");
    expect(v.deltas.resolve_rate).toBeCloseTo(-0.05, 5);
  });

  it("multi-objective: one dim improves, another regresses → reject (any regression rejects)", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // resolve_rate improves but token regresses (candidate.token up = worse)
    const candidate = makeFitness({ resolve_rate: 0.55, token: 150, cache_hit: 0.5 });
    const v = gate.decide(baseline, candidate);
    expect(v.accept).toBe(false);
    expect(v.regressions).toContain("token");
  });

  it("token direction flipped (lower=better): candidate.token down → accept; up → reject", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // token down = improvement
    const improved = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.5, token: 80, cache_hit: 0.5 }),
    );
    expect(improved.accept).toBe(true);
    // token up = regression (pin: must NOT be flipped into acceptance)
    const regressed = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.5, token: 120, cache_hit: 0.5 }),
    );
    expect(regressed.accept).toBe(false);
    expect(regressed.regressions).toContain("token");
  });

  it("cache_hit direction NOT flipped (higher=better, same as resolve_rate): up → accept; down → reject + regressions=['cache_hit']", () => {
    // Pin: cache_hit direction must be opposite to token — high=better.
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    const improved = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.6 }),
    );
    expect(improved.accept).toBe(true);
    const regressed = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.4 }),
    );
    expect(regressed.accept).toBe(false);
    expect(regressed.regressions).toContain("cache_hit");
  });

  it("τ=0.02, regression 0.01 < τ → accept (threshold boundary)", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0.02, token: 0.02, cache_hit: 0.02 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // resolve_rate down 0.01 < 0.02 → within tolerance → accept
    const v = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.49, token: 100, cache_hit: 0.5 }),
    );
    expect(v.accept).toBe(true);
  });

  it("τ unspecified for a dim → default τ=0 (boundary: missing config)", () => {
    const gate = new StrictImprovementGate({ tau: { resolve_rate: 0 } });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // token regresses by 1 — no τ configured → default 0 → reject
    const v = gate.decide(
      baseline,
      makeFitness({ resolve_rate: 0.5, token: 101, cache_hit: 0.5 }),
    );
    expect(v.accept).toBe(false);
    expect(v.regressions).toContain("token");
  });

  it("candidate fitness missing a field (raw incomplete) → throws IncompleteFitness", () => {
    const gate = new StrictImprovementGate({
      tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    });
    const baseline = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // @ts-expect-error deliberate incomplete fitness
    const incomplete: Fitness = { resolve_rate: 0.6, token: 100 } as Fitness;
    expect(() => gate.decide(baseline, incomplete)).toThrow(IncompleteFitness);
  });
});
