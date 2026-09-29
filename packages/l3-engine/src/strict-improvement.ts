// L3-T04: strict-improvement 硬门（held-out 任一指标退化 ≥ τ → reject） [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T04.
//
// Direction pins (four spec statements must stay aligned):
//   - resolve_rate: higher = better (NO flip).
//   - cache_hit:    higher = better (NO flip; same as resolve_rate, opposite
//     to token — pin to prevent accidental flip into false rejection).
//   - token:        lower = better (FLIPPED — candidate.token < baseline.token
//     is an improvement; candidate.token > baseline.token is a regression).
//
// A candidate is rejected iff ANY dimension regresses by ≥ τ for that dim.
// τ defaults to 0 per dimension when unspecified (strictest).

import type { Fitness } from "./types.js";

// Error thrown when a candidate Fitness is missing a required field.
export class IncompleteFitness extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteFitness";
  }
}

// Dimensions compared by the gate (excludes the optional `raw` field).
// Tightened to a literal tuple so `keyof Fitness` (which includes the
// optional `raw` field) does not leak into Record types below — that leak
// made `Record<keyof Fitness, number>` demand a mandatory `raw` while the
// spread-based constructor left `raw` optional, tripping tsc (TS2322).
const COMPARED_DIMS = ["resolve_rate", "token", "cache_hit"] as const;
type ComparedDim = (typeof COMPARED_DIMS)[number]; // ⊂ keyof Fitness

// Dimensions where "higher = better" (no direction flip).
const HIGHER_BETTER = new Set<ComparedDim>(["resolve_rate", "cache_hit"]);
// token: lower = better (direction flipped).

export interface Decision {
  accept: boolean;
  regressions: (keyof Fitness)[];
  deltas: Partial<Record<keyof Fitness, number>>;
  /** "strict"(默认)=无退化且至少一维改进; "non-inferiority"=仅无退化(旧语义, 须显式声明)。 */
  mode: "strict" | "non-inferiority";
  reason: "improved" | "regression" | "no-improvement";
}

export class StrictImprovementGate {
  private readonly tau: Record<ComparedDim, number>;
  private readonly minImprovement: Record<ComparedDim, number>;
  private readonly mode: "strict" | "non-inferiority";

  constructor(opts: {
    tau: Partial<Record<keyof Fitness, number>>;
    minImprovement?: Partial<Record<keyof Fitness, number>>;
    mode?: "strict" | "non-inferiority";
  }) {
    // Explicit per-dim construction makes the "τ unspecified → default 0"
    // contract structural instead of relying on spread fallback.
    this.tau = {
      resolve_rate: opts.tau.resolve_rate ?? 0,
      token: opts.tau.token ?? 0,
      cache_hit: opts.tau.cache_hit ?? 0,
    };
    this.minImprovement = {
      resolve_rate: opts.minImprovement?.resolve_rate ?? 0,
      token: opts.minImprovement?.token ?? 0,
      cache_hit: opts.minImprovement?.cache_hit ?? 0,
    };
    // ISS-01: 默认 strict —— 杜绝「不退化即放行」导致的 Δ=0 原地进化。
    this.mode = opts.mode ?? "strict";
  }

  decide(baseline: Fitness, candidate: Fitness): Decision {
    // Error path: candidate/baseline fitness must carry every compared dim.
    for (const dim of COMPARED_DIMS) {
      if (typeof candidate[dim] !== "number") {
        throw new IncompleteFitness(
          `candidate fitness missing field: ${String(dim)}`,
        );
      }
      if (typeof baseline[dim] !== "number") {
        throw new IncompleteFitness(
          `baseline fitness missing field: ${String(dim)}`,
        );
      }
    }

    const regressions: (keyof Fitness)[] = [];
    const deltas: Partial<Record<keyof Fitness, number>> = {};
    const improvedDims: ComparedDim[] = [];

    for (const dim of COMPARED_DIMS) {
      const b = baseline[dim] as number;
      const c = candidate[dim] as number;
      // Raw delta = candidate - baseline (signed observation, NOT
      // direction-adjusted). Tests pin resolve_rate delta = c - b.
      deltas[dim] = c - b;

      const higherBetter = HIGHER_BETTER.has(dim);
      // "Improvement amount" along this dim's direction:
      //   higher-better: improvement = c - b  (positive = better)
      //   lower-better : improvement = b - c  (positive = better)
      const improvement = higherBetter ? c - b : b - c;

      // Regression when improvement is negative beyond tolerance:
      //   improvement < -τ  ⇒  regression magnitude ≥ τ.
      if (improvement < -this.tau[dim]) {
        regressions.push(dim);
      }
      // ISS-01: 严格模式要求至少一维按方向改进 > minImprovement。
      if (improvement > this.minImprovement[dim]) {
        improvedDims.push(dim);
      }
    }

    const noRegression = regressions.length === 0;
    const hasImprovement = improvedDims.length > 0;

    let accept: boolean;
    if (this.mode === "non-inferiority") {
      accept = noRegression;
    } else {
      accept = noRegression && hasImprovement;
    }

    const reason: Decision["reason"] = !noRegression
      ? "regression"
      : hasImprovement
        ? "improved"
        : "no-improvement";

    return {
      accept,
      regressions,
      deltas,
      mode: this.mode,
      reason,
    };
  }
}
