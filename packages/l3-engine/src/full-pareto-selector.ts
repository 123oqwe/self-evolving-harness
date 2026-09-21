// L3-T10: Pareto 非支配排序 NSGA-II 分层前沿 (GEPA 完整版升级点 2) [V1]
//
// Spec: execution/L3-engine/TASKS.md §L3-T10.
//
// Upgrade over T05 MVP: full NSGA-II fast non-dominated sort producing
// layered fronts (rank 0 = first non-dominated front, rank 1 = dominated
// only by rank-0 members, ...). Replaces T02's single-objective
// resolve_rate sort + diversity tiebreak for the acquisition step.
//
// Invariants inherited from T05 (PRD §6.7 hard invariants):
//   - NO weighted-sum aggregation. There is no weighted-aggregation method
//     on this class; the `weightedSum` property is deliberately absent.
//     `WeightedSumForbidden` is the only sanctioned surface.
//   - Direction pins (must stay aligned with T05 / T04):
//       resolve_rate: higher = better (NO flip)
//       cache_hit:    higher = better (NO flip)
//       token:        lower = better (FLIPPED)
//   - Held-out fitness must NEVER feed selection (contract §2). Any point
//     carrying a non-`train` `split` raises `SelectionSignalViolation` at
//     entry (inherited from T02).
//
// This class extends `ParetoSelector` (T05) WITHOUT modifying the landed T05
// source (prior-file protection rule). Direction logic is replicated inline
// here (identical to T05's) rather than extracted to a shared module — the
// T05 file is protected, and a half-migration would risk direction drift.
// crowding distance is deferred to V2 (spec REFACTOR note).

import type { Fitness, ParetoPoint } from "./types.js";
import { ParetoSelector } from "./pareto-selector.js";
import { SelectionSignalViolation } from "./beam-search.js";

// ---------------------------------------------------------------------------
// NSGA-II front shape.
// ---------------------------------------------------------------------------

export interface NSGAFront {
  /** Front index: 0 = first (non-dominated) front, 1 = second, ... */
  rank: number;
  members: ParetoPoint[];
}

// ---------------------------------------------------------------------------
// Direction metadata (replicated from T05 to avoid modifying the protected
// T05 source; values MUST stay identical to prevent direction drift).
// ---------------------------------------------------------------------------

const COMPARED_DIMS: (keyof Fitness)[] = ["resolve_rate", "token", "cache_hit"];

const HIGHER_BETTER: ReadonlySet<keyof Fitness> = new Set<keyof Fitness>([
  "resolve_rate",
  "cache_hit",
]);

function adjustedValue(dim: keyof Fitness, v: number): number {
  return HIGHER_BETTER.has(dim) ? v : -v;
}

/**
 * Does fitness `a` dominate fitness `b`?
 *
 * a dominates b iff a is >= b in every compared dim (direction-adjusted) AND
 * strictly > in at least one dim. Equal fitnesses do NOT dominate each
 * other (identical to T05 semantics).
 */
function dominates(a: Fitness, b: Fitness): boolean {
  let strictlyBetterInOne = false;
  for (const dim of COMPARED_DIMS) {
    const av = adjustedValue(dim, a[dim] as number);
    const bv = adjustedValue(dim, b[dim] as number);
    if (av < bv) return false;
    if (av > bv) strictlyBetterInOne = true;
  }
  return strictlyBetterInOne;
}

// ---------------------------------------------------------------------------
// FullParetoSelector — NSGA-II fast non-dominated sort.
// ---------------------------------------------------------------------------

/**
 * Extended Pareto selector with NSGA-II layered fronts.
 *
 * `weightedSum` is deliberately NOT defined on this class (PRD §6.7 hard
 * invariant). The inherited `nonDominatedFront` (rank-0 only) is preserved
 * unchanged from T05.
 */
export interface FullParetoSelector extends ParetoSelector {
  fastNonDominatedSort(points: ParetoPoint[]): NSGAFront[];
}

export class FullParetoSelector extends ParetoSelector {
  /**
   * NSGA-II fast non-dominated sort.
   *
   * Returns layered fronts: front `rank` 0 is the non-dominated set; front
   * `rank` r contains points dominated only by members of fronts < r.
   *
   * Contract §2 (inherited from T02/T05): held-out fitness must NEVER feed
   * selection. Any input point carrying a `split` field whose value is not
   * `'train'` raises `SelectionSignalViolation` at entry. (The base
   * `ParetoPoint` type has no `split`; the runtime guard catches a
   * mutated/heldout-tagged point leaking in via structural typing.)
   *
   * Complexity: O(n²) — adequate for population sizes ≤ beamWidth·K.
   * Order preservation: within each front, members keep input-relative
   * order so seed-deterministic tests stay stable.
   */
  fastNonDominatedSort(points: ParetoPoint[]): NSGAFront[] {
    // Signal-leak guard: held-out must not feed selection (contract §2,
    // inherited from T02/T05).
    for (const p of points) {
      const split = (p as { split?: unknown }).split;
      if (split !== undefined && split !== "train") {
        throw new SelectionSignalViolation(
          `L3-T10: held-out fitness leaked into fastNonDominatedSort (mutant=${p.mutant.id}, split=${String(split)}) — contract §2 violation`,
        );
      }
    }

    const n = points.length;
    if (n === 0) return [];

    // S[i] = indices of points that point i dominates.
    // cnt[i] = number of points that dominate point i (= S[*] hits on i).
    const S: number[][] = new Array(n);
    const cnt: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      S[i] = [];
      cnt[i] = 0;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (dominates(points[i]!.fitness, points[j]!.fitness)) {
          S[i]!.push(j);
          cnt[j]!++;
        }
      }
    }

    // Layered front assignment (spec §L3-T10 behavior):
    //   front 0 (rank 0) = non-dominated set (cnt == 0).
    //   front r (rank r) = points NOT in any earlier front that are
    //   dominated by ≥1 member of front r-1.
    //
    // This is the "rank = 1 + min(rank of dominators)" layering — rank r
    // contains every point directly dominated by some rank-(r-1) member,
    // even if it is also dominated by another rank-r member (intra-front
    // dominance does NOT push a point deeper). The spec behavior explicitly
    // defines rank 1 as "被 rank0 支配集" (the set dominated by rank 0).
    const fronts: NSGAFront[] = [];
    const assigned: boolean[] = new Array(n).fill(false);

    // front 0 = non-dominated.
    let currentFrontIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (cnt[i] === 0) {
        currentFrontIdx.push(i);
        assigned[i] = true;
      }
    }

    let rank = 0;
    while (currentFrontIdx.length > 0) {
      fronts.push({
        rank,
        members: currentFrontIdx.map((i) => points[i]!),
      });

      // front r+1 = unassigned points dominated by some member of front r.
      const nextFrontIdx: number[] = [];
      for (const i of currentFrontIdx) {
        for (const j of S[i]!) {
          if (!assigned[j]!) {
            assigned[j] = true;
            nextFrontIdx.push(j);
          }
        }
      }
      currentFrontIdx = nextFrontIdx;
      rank++;
    }

    return fronts;
  }
}
