// L3-T10: full-population reflective mutation (GEPA 完整版升级点 1) [V1]
//
// Spec: execution/L3-engine/TASKS.md §L3-T10.
//
// Upgrade over T02 降配版: instead of reflecting only on the single best
// beam candidate, the full-population beam search reflects on the ENTIRE
// top-K population — each candidate independently triggers a reflective
// mutation pass over the aggregated failure trajectories. This widens the
// exploration frontier (the GEPA payoff measured by the front-size test).
//
// This class extends `BeamSearchOptimizer` (T02) WITHOUT modifying the
// landed T02 source (prior-file protection rule). It overrides `generate`
// to consume `ctx.population` and fan out reflective mutation per candidate.
//
// ERRATA-w2plus L3-09: OptContext extended with `population` for V1.

import type {
  Optimizer,
  OptContext,
  Substrate,
  Mutant,
  Trajectory,
} from "./types.js";
import { BeamSearchOptimizer } from "./beam-search.js";
import type { ScoredMutant } from "./beam-search.js";

// ---------------------------------------------------------------------------
// Reflective mutation port (batch / per-candidate).
// ---------------------------------------------------------------------------

/**
 * Minimal reflective-mutation port satisfied by `ReflectiveMutator` (T03) and
 * by test spies. `mutate(substrate, failures)` returns ≥0 mutation candidates
 * derived from the aggregated failure-trajectory diagnoses.
 *
 * Tests inject `{ mutate: spyFn }` directly (see T10 spec TDD).
 */
export interface ReflectivePort {
  mutate(substrate: Substrate, failures: Trajectory[]): Promise<Mutant[]>;
}

// ---------------------------------------------------------------------------
// FullPopulationBeamSearchOptions.
// ---------------------------------------------------------------------------

export interface FullPopulationBeamSearchOptions {
  beamWidth: number;
  prngSeed: number;
  /**
   * Reflective-mutation port. Each top-K population candidate triggers one
   * `mutate` call (full-population reflection, the V1 upgrade over T02's
   * single-best reflection).
   */
  reflective: ReflectivePort;
  /** Optional evaluator (inherited semantics from BeamSearchOptimizer). */
  evaluator?: import("./types.js").Evaluator;
  /** Optional diversity metric (inherited). */
  diversityMetric?: (a: Mutant, b: Mutant) => number;
}

// ---------------------------------------------------------------------------
// OptContext extension carrying the population (ERRATA-w2plus L3-09).
// ---------------------------------------------------------------------------

/**
 * Full-population optimization context. `population` is the top-K scored
 * candidates from the previous generation; `generate` reflects on EACH of
 * them (not just `best`).
 *
 * `population` is optional on the base `OptContext` to avoid modifying the
 * landed T01 type; this local extension declares it required.
 */
export type FullPopulationContext = OptContext & {
  population: ScoredMutant[];
};

// ---------------------------------------------------------------------------
// FullPopulationBeamSearch.
// ---------------------------------------------------------------------------

export class FullPopulationBeamSearch extends BeamSearchOptimizer implements Optimizer {
  private readonly reflective: ReflectivePort;

  constructor(opts: FullPopulationBeamSearchOptions) {
    const base: import("./beam-search.js").BeamSearchOptimizerOptions = {
      beamWidth: opts.beamWidth,
      prngSeed: opts.prngSeed,
    };
    if (opts.diversityMetric !== undefined) {
      base.diversityMetric = opts.diversityMetric;
    }
    if (opts.evaluator !== undefined) {
      base.evaluator = opts.evaluator;
    }
    super(base);
    this.reflective = opts.reflective;
  }

  /**
   * Full-population reflective mutation.
   *
   * For each of the top-K population candidates (K = min(beamWidth,
   * population.length)), call `reflective.mutate(substrate, trajectories)`
   * once and aggregate the produced mutants. The aggregated failure
   * trajectories (`ctx.trajectories`) are shared across candidates (GEPA
   * full-population reflection — every candidate sees the full failure
   * diagnosis, not just the best).
   *
   * Behaviour:
   *  - Empty population → returns `[]` (no candidates to reflect on; no
   *    mutate calls). This keeps the no-population branch a pure
   *    non-throwing producer so robustness assertions hold.
   *  - Non-empty population → exactly K mutate calls (one per top-K
   *    candidate). Test assertion: `spyMutate.calls === K`, NOT 1.
   *
   * The top-K selection sorts the population by `resolve_rate` desc (the
   * hill-climb primary key inherited from T02) so the strongest candidates
   * are reflected first; this matches the "top-K 候选" wording in the spec.
   */
  override async generate(
    substrate: Substrate,
    ctx: FullPopulationContext,
  ): Promise<Mutant[]> {
    const population = ctx.population ?? [];
    if (population.length === 0) return [];

    // Top-K by resolve_rate desc (stable: input order breaks ties).
    const ordered = [...population].sort((a, b) => {
      const fr = b.fitness.resolve_rate - a.fitness.resolve_rate;
      if (fr !== 0) return fr;
      return a.mutant.id.localeCompare(b.mutant.id);
    });
    const k = Math.min(this.beamWidth, ordered.length);
    const top = ordered.slice(0, k);

    const trajectories: Trajectory[] = ctx.trajectories ?? [];
    const out: Mutant[] = [];
    for (const sm of top) {
      // Each top-K candidate triggers an independent reflective mutation
      // pass over the aggregated failure trajectories (full-population
      // reflection — the V1 upgrade over T02's single-best reflection).
      const produced = await this.reflective.mutate(substrate, trajectories);
      for (const m of produced) out.push(m);
    }
    return out;
  }
}
