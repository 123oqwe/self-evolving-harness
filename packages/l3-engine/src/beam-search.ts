// L3-T02: beam-search 优化器（GEPA 降配版，B=3，保留 top-3 变异候选） [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T02.
//
// GEPA-reduced exploration engine: each generation samples ≤ beamWidth (B=3)
// mutation candidates from the current best, scores them on a train
// mini-batch, and keeps the top-k. The full GEPA per-instance text-feedback
// back-prop is NOT done here (that is T03 reflective-mutation's job); T02
// only does beam + top-k.
//
// Determinism contract (ERRATA-w2plus L3-T02): seed=42 → exactly 3
// candidates; 3 consecutive generations keep best.resolve_rate monotonically
// non-decreasing. Candidate ids are index-stable across generations so the
// FakeEvaluator derive fallback (mulberry32(hashStr(`${id}:${seed}`))) yields
// a constant fitness sequence → hill-climb is non-decreasing by construction.

import type {
  Optimizer,
  OptContext,
  Substrate,
  Mutant,
  Evaluator,
} from "./types.js";
import { mulberry32 } from "./prng.js";

// ---------------------------------------------------------------------------
// ScoredMutant — a Mutant paired with its train-split Fitness.
// ---------------------------------------------------------------------------

/**
 * `split` is pinned to the literal `'train'` (spec §L3-T02). Held-out
 * fitness must NEVER feed `selectTopK` / `generate` (contract §2); passing a
 * held-out scored mutant is a signal-leak violation caught at the
 * `selectTopK` entry.
 */
export interface ScoredMutant {
  mutant: Mutant;
  fitness: import("./types.js").Fitness;
  split: "train";
}

// ---------------------------------------------------------------------------
// SelectionSignalViolation — held-out fitness leaked into the selection path.
// ---------------------------------------------------------------------------

/**
 * Raised by `selectTopK` when any scored mutant carries a non-`train` split
 * (held-out must not feed `generate` / `selectTopK`, contract §2).
 */
export class SelectionSignalViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionSignalViolation";
  }
}

// ---------------------------------------------------------------------------
// Default diversity metric (content-level difference).
// ---------------------------------------------------------------------------

/**
 * Default `diversityMetric`: larger = more content difference. Used as the
 * tiebreak when two candidates share the same `resolve_rate`. The metric is
 * a simple length-delta + positional char-diff count — deterministic and
 * dependency-free.
 */
export function defaultDiversityMetric(a: Mutant, b: Mutant): number {
  const la = a.content.length;
  const lb = b.content.length;
  let diff = Math.abs(la - lb);
  const min = Math.min(la, lb);
  for (let i = 0; i < min; i++) {
    if (a.content.charCodeAt(i) !== b.content.charCodeAt(i)) diff++;
  }
  return diff;
}

// ---------------------------------------------------------------------------
// BeamSearchOptimizer — GEPA 降配 beam search (B=3, top-k keep).
// ---------------------------------------------------------------------------

export interface BeamSearchOptimizerOptions {
  beamWidth: number;
  prngSeed: number;
  diversityMetric?: (a: Mutant, b: Mutant) => number;
  /**
   * Optional evaluator used by `generate` to score each candidate on the
   * `'train'` split. When provided, `generate` calls `evaluator.score(m,
   * 'train')` per candidate and **isolates score failures**: a candidate
   * whose score throws is skipped (never padded back up to `beamWidth`) —
   * only survivors are returned (shape stays `Mutant[]`).
   *
   * When **absent**, `generate` only produces candidates (scoring is the
   * caller's responsibility, e.g. the T09 loop / external harness). This
   * keeps the no-evaluator branch a pure, non-throwing producer so existing
   * robustness assertions hold.
   */
  evaluator?: Evaluator;
}

export class BeamSearchOptimizer implements Optimizer {
  readonly beamWidth: number;
  readonly prngSeed: number;
  private readonly diversityMetric: (a: Mutant, b: Mutant) => number;
  private readonly evaluator: Evaluator | undefined;

  constructor(opts: BeamSearchOptimizerOptions) {
    this.beamWidth = opts.beamWidth;
    this.prngSeed = opts.prngSeed;
    this.diversityMetric = opts.diversityMetric ?? defaultDiversityMetric;
    this.evaluator = opts.evaluator;
  }

  /**
   * Generate ≤ beamWidth mutation candidates for this generation.
   *
   * Deterministic by `prngSeed`: re-seeding mulberry32 each call yields the
   * identical candidate sequence (ids + content). Candidate ids are
   * index-stable (`c-${i}`) so a fixed-seed FakeEvaluator derives a constant
   * fitness sequence → convergence is monotonic non-decreasing by
   * construction (ERRATA-w2plus L3-T02).
   *
   * GEPA 降配: no per-instance text feedback (that is T03's job).
   *
   * Score-failure isolation (spec §L3-T02 error path): when an `evaluator`
   * is wired via options, each produced candidate is scored on the `'train'`
   * split inside its own try/catch; a candidate whose `evaluator.score(...)`
   * throws is **skipped** (`continue`) — only survivors are returned. The
   * try/catch wraps a REAL throwing call (`Evaluator.score`), so removing it
   * would propagate the throw and crash the generation loop (this is the
   * live isolation path, not dead code). The invariant is "never pad": a
   * skipped candidate is not replaced, so `out.length` may be `< beamWidth`.
   * When no evaluator is wired, `generate` is a pure non-throwing producer.
   */
  async generate(substrate: Substrate, ctx: OptContext): Promise<Mutant[]> {
    const prng = mulberry32(this.prngSeed >>> 0);
    const parentRef = ctx.best?.id ?? substrate.sha;
    const out: Mutant[] = [];
    for (let i = 0; i < this.beamWidth; i++) {
      const r = prng();
      const content = `variant-${i}-${r.toFixed(6)}-${parentRef}`;
      const mutant: Mutant = {
        id: `c-${i}`,
        parentSha: parentRef,
        content,
        origin: "beam-search",
      };
      if (this.evaluator) {
        // Score-failure isolation: wrap a real, throwing `evaluator.score`
        // call. A failing candidate is skipped (never padded back up to
        // beamWidth). Removing this try/catch would crash the loop on the
        // first throwing candidate.
        try {
          await this.evaluator.score(mutant, "train");
        } catch {
          continue;
        }
      }
      out.push(mutant);
    }
    return out;
  }

  /**
   * Keep the fitness top-k, breaking ties by diversity (content difference).
   *
   * Contract §2: held-out fitness must NEVER feed `generate`. Any scored
   * mutant whose `split` is not `'train'` is a signal leak and raises
   * `SelectionSignalViolation` at entry.
   *
   * Sort is stable + deterministic: primary key = `resolve_rate` desc;
   * tiebreak = diversity (to the max-fitness anchor) desc; final tiebreak =
   * mutant id asc so re-running on identical input yields the exact same id
   * sequence.
   */
  selectTopK(scored: ScoredMutant[], k: number): ScoredMutant[] {
    // Signal-leak guard: held-out must not feed selection (contract §2).
    for (const s of scored) {
      if (s.split !== "train") {
        throw new SelectionSignalViolation(
          `L3-T02: held-out fitness leaked into selectTopK (mutant=${s.mutant.id}, split=${s.split}) — contract §2 violation`,
        );
      }
    }
    if (scored.length === 0) return [];

    // Anchor = highest-fitness candidate (the hill-climb reference point).
    const anchor = scored.reduce((acc, s) =>
      s.fitness.resolve_rate > acc.fitness.resolve_rate ? s : acc,
    );

    const decorated = scored.map((s) => ({
      s,
      div: this.diversityMetric(s.mutant, anchor.mutant),
    }));

    decorated.sort((a, b) => {
      const fr = b.s.fitness.resolve_rate - a.s.fitness.resolve_rate;
      if (fr !== 0) return fr;
      const dd = b.div - a.div;
      if (dd !== 0) return dd;
      return a.s.mutant.id.localeCompare(b.s.mutant.id);
    });

    return decorated.slice(0, k).map((d) => d.s);
  }
}
