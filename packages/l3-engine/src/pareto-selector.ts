// L3-T05: Pareto 多目标选择器（resolve_rate ∧ token ∧ cache_hit，无加权求和） [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T05.
//
// Direction pins (must stay aligned with T04 strict-improvement):
//   - resolve_rate: higher = better (NO flip).
//   - cache_hit:    higher = better (NO flip; same as resolve_rate, opposite
//     to token — pin to prevent accidental flip).
//   - token:        lower = better (FLIPPED).
//
// Hard invariant (PRD §6.7): NO weighted-sum aggregation. The forbidden
// camelCase identifier must never appear in this file (locked by the T05
// grep test). Multi-objective selection uses non-dominated sorting only.
//
// MVP uses simple O(n²) pairwise dominance (candidate count ≤ beamWidth=3
// is ample). Full NSGA-II fast non-dominated sort lands in V1 (L3-T10).

import type { Fitness, ParetoPoint } from "./types.js";

// Error thrown when any code path attempts a weighted-sum aggregation.
// Exported so tests can assert the invariant; the class itself is the only
// sanctioned surface — there is no weighted-aggregation method on the selector.
export class WeightedSumForbidden extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeightedSumForbidden";
  }
}

// ---------------------------------------------------------------------------
// Direction metadata (shared shape with T04; REFACTOR note in spec suggests
// extracting to metric-direction.ts — kept inline here to avoid touching the
// already-landed T04 file, which is a prior-task file protected by the
// "同包前序任务文件不删改" rule).
// ---------------------------------------------------------------------------

const COMPARED_DIMS: (keyof Fitness)[] = [
  "resolve_rate",
  "token",
  "cache_hit",
];

// Dimensions where "higher = better" (no direction flip). token is flipped
// (lower = better).
const HIGHER_BETTER: ReadonlySet<keyof Fitness> = new Set<keyof Fitness>([
  "resolve_rate",
  "cache_hit",
]);

/**
 * Direction-adjusted comparison value for a single dimension.
 * Returns a number where "bigger = better" regardless of the dim's native
 * direction (token is negated so lower-token → higher adjusted value).
 */
function adjustedValue(dim: keyof Fitness, v: number): number {
  return HIGHER_BETTER.has(dim) ? v : -v;
}

/**
 * Does fitness `a` dominate fitness `b`?
 *
 * a dominates b iff a is >= b in every compared dim (direction-adjusted) AND
 * strictly > in at least one dim. Equal fitnesses do NOT dominate each
 * other (tied points are all kept — boundary case).
 *
 * The `raw` field is never compared (it is diagnostic metadata, not an
 * objective).
 */
function dominates(a: Fitness, b: Fitness): boolean {
  let strictlyBetterInOne = false;
  for (const dim of COMPARED_DIMS) {
    const av = adjustedValue(dim, a[dim] as number);
    const bv = adjustedValue(dim, b[dim] as number);
    if (av < bv) {
      // a is worse in this dim → cannot dominate b.
      return false;
    }
    if (av > bv) {
      strictlyBetterInOne = true;
    }
  }
  return strictlyBetterInOne;
}

export interface ParetoSelector {
  nonDominatedFront(points: ParetoPoint[]): ParetoPoint[];
}

export class ParetoSelector {
  /**
   * Return the Pareto non-dominated front: all points not dominated by any
   * other point in the input. Order is preserved (input-relative) to keep
   * seed-deterministic tests stable.
   *
   * No weighted-sum is performed (PRD §6.7 hard invariant). There is no
   * weighted-aggregation method on this class — calling a hypothetical one
   * throws WeightedSumForbidden (see T05 invariant test).
   */
  nonDominatedFront(points: ParetoPoint[]): ParetoPoint[] {
    const front: ParetoPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const candidate = points[i]!;
      let dominated = false;
      for (let j = 0; j < points.length; j++) {
        if (j === i) continue;
        const other = points[j]!;
        if (dominates(other.fitness, candidate.fitness)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) {
        front.push(candidate);
      }
    }
    return front;
  }
}
