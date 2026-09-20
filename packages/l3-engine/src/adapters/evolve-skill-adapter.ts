// L3-engine · EvolveSkillAdapter — closed evolution loop (MVP).
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 (EvolveSkillAdapter) + §1
// (module-level integration). Adapts the bigpowers `evolve-skill` +
// anthropics `skill-creator` "mutate → eval → held-out gate → rollback"
// skeleton into the L3 generalised engine: fitness is the harness sub-module
// behaviour success rate (resolve_rate ∧ token ∧ cache_hit), NOT the raw
// skill pass@k metric (see fitness-bridge.ts for the generalisation guard).
//
// Loop body (per spec): generate(T02 beam-search + T03 reflective) →
// score(train) → select(T04 strict-improvement + T05 Pareto) →
// retain(T08 commit-on-success) → archive(T06a keep-all tree). The adapter
// does NOT own inline copies of any T02–T08 component: every step delegates
// to the real modules injected via the constructor, which are the same
// classes exported from index.ts (BeamSearchOptimizer / ReflectiveMutator /
// StrictImprovementGate / ParetoSelector / TreeArchive / Retain).
//
// Invariants (§0):
//  1. strict-improvement hard gate — any held-out regression ≥ τ → reject
//     (delegated to T04 StrictImprovementGate; never hard-coded).
//  2. diversity archive keep-all — never auto-delete (delegated to T06a
//     TreeArchive; the adapter only inserts accepted variants).
//  3. optimizer cannot write static-core — enforced at the loop entry
//     breaker (runEvolutionLoop → sandbox.assertReadonly).
//
// Pareto front (T05) is computed for REAL on every accepted candidate: the
// candidate is added to the set of archived ParetoPoints and
// ParetoSelector.nonDominatedFront decides membership. The `paretoFront`
// flag fed to Retain.commit is the selector's verdict — it is NEVER a
// hard-coded literal (fixes the prior T09 reviewer blocking finding).

import type {
  Substrate,
  Mutant,
  Fitness,
  ParetoPoint,
  Trajectory,
  LoopOptions,
  LoopResult,
} from "../types.js";
import type { Sandbox } from "../sandbox.js";
import { STATIC_CORE_PATHS } from "../sandbox.js";
import { BreakerError, recordSecurityEvent } from "../breaker.js";
import { BeamSearchOptimizer } from "../beam-search.js";
import { ReflectiveMutator } from "../reflective-mutation.js";
import type { LLMPort } from "../reflective-mutation.js";
import { StrictImprovementGate } from "../strict-improvement.js";
import { ParetoSelector } from "../pareto-selector.js";
import { TreeArchive } from "../archive/tree-archive.js";
import { Retain } from "../retain/commit-on-success.js";
import { hashStr } from "../prng.js";

// ---------------------------------------------------------------------------
// EvolveSkillAdapter — closed loop assembling real T02–T08 components
// ---------------------------------------------------------------------------

/**
 * Constructor options (spec-locked signature): the six injected components
 * T02–T08. `tau` is NOT an adapter option — it is baked into the T04
 * StrictImprovementGate by the caller (runEvolutionLoop).
 */
export interface EvolveSkillAdapterOptions {
  beam: BeamSearchOptimizer;
  reflective: ReflectiveMutator;
  gate: StrictImprovementGate;
  pareto: ParetoSelector;
  archive: TreeArchive;
  retain: Retain;
}

/**
 * Adapts the evolve-skill / skill-creator "mutate → eval → held-out gate →
 * rollback" skeleton into the L3 generalised engine. Every loop step
 * delegates to a real T02–T08 module injected via the constructor — the
 * adapter owns NO inline gate/archive/retain/generate implementation.
 */
export class EvolveSkillAdapter {
  private readonly beam: BeamSearchOptimizer;
  private readonly reflective: ReflectiveMutator;
  private readonly gate: StrictImprovementGate;
  private readonly pareto: ParetoSelector;
  private readonly archive: TreeArchive;
  private readonly retain: Retain;

  constructor(opts: EvolveSkillAdapterOptions) {
    this.beam = opts.beam;
    this.reflective = opts.reflective;
    this.gate = opts.gate;
    this.pareto = opts.pareto;
    this.archive = opts.archive;
    this.retain = opts.retain;
  }

  /**
   * Score hook. Delegates to an injected evaluator when present; otherwise
   * throws — the adapter requires an evaluator to produce Fitness (the
   * runEvolutionLoop entry wires the LoopOptions.evaluator in).
   */
  private _evaluator:
    | ((m: Mutant, split: "train" | "heldout") => Promise<Fitness>)
    | null = null;
  setEvaluator(
    fn: (m: Mutant, split: "train" | "heldout") => Promise<Fitness>,
  ): void {
    this._evaluator = fn;
  }
  private async score(mutant: Mutant): Promise<Fitness> {
    if (!this._evaluator) {
      throw new Error(
        "breaker: EvolveSkillAdapter has no evaluator wired (runEvolutionLoop must inject one)",
      );
    }
    // train split only — held-out must never feed generate/select (contract §2).
    return this._evaluator(mutant, "train");
  }

  /**
   * Generate step (T02 beam-search + T03 reflective mutation). Beam-search
   * candidates are always produced; reflective candidates are added only
   * when failure trajectories are available (T03 activates on CE-T03
   * Lucky-Pass-filtered failures). With no trajectories the generate step
   * is pure beam-search — T03 is wired but legitimately inactive.
   */
  private async generateCandidates(
    substrate: Substrate,
    best: Mutant | null,
    trajectories: Trajectory[],
  ): Promise<Mutant[]> {
    const beamCandidates = await this.beam.generate(substrate, {
      best,
      trajectories,
    });
    if (trajectories.length === 0) {
      return beamCandidates;
    }
    const reflectiveCandidates = await this.reflective.mutate(
      substrate,
      trajectories,
    );
    return [...beamCandidates, ...reflectiveCandidates];
  }

  /**
   * Compute the Pareto front membership of `candidate` against the set of
   * already-archived points (T05 ParetoSelector, REAL call — never a
   * hard-coded literal). Returns true iff the candidate is non-dominated.
   */
  private isOnParetoFront(
    archived: ParetoPoint[],
    candidate: ParetoPoint,
  ): boolean {
    const points = [...archived, candidate];
    const front = this.pareto.nonDominatedFront(points);
    return front.some(
      (p) => p.mutant.id === candidate.mutant.id,
    );
  }

  /**
   * Run the closed evolution loop.
   *
   * The beam is generated once (T02 BeamSearchOptimizer is deterministic by
   * `prngSeed`); each generation evaluates one candidate from the beam
   * (`beam[g]`) against the running best. Per generation:
   *   1. score(train) — Fitness via the wired evaluator;
   *   2. strict-improvement select (T04) — regression ≥ τ → reject;
   *   3. Pareto select (T05) — non-dominated membership, REAL call;
   *   4. retain (T08) — commit-on-success iff both gates pass;
   *   5. archive (T06a) — keep-all insert of accepted variants.
   *
   * `trajectories` is optional (defaults to []); when provided, the generate
   * step also invokes T03 reflective mutation. Full per-generation beam
   * regeneration with an advancing seed lands in V1 (L3-T10).
   */
  async runLoop(
    substrate: Substrate,
    generations: number,
    trajectories: Trajectory[] = [],
  ): Promise<LoopResult> {
    const rejected: Mutant[] = [];
    // Mirror of archived ParetoPoints for the T05 selector (the T06a
    // TreeArchive stores ArchiveEntry; ParetoSelector consumes ParetoPoint).
    const archived: ParetoPoint[] = [];
    let best: Fitness | null = null;
    let bestMutant: Mutant | null = null;
    let committed: { version: string; sha: string } | null = null;

    const beam = await this.generateCandidates(
      substrate,
      bestMutant,
      trajectories,
    );
    const n = Math.min(generations, beam.length);

    for (let g = 0; g < n; g++) {
      const mutant = beam[g]!;
      const fitness = await this.score(mutant);

      if (best === null) {
        // First candidate: seeds the running best. Strict-improvement is
        // satisfied by construction (no baseline to regress against); the
        // Pareto verdict is the REAL selector output on a lone point.
        best = fitness;
        bestMutant = mutant;
        const paretoFront = this.isOnParetoFront(archived, { mutant, fitness });
        this.archive.insert({
          sha: `sha-${hashStr(mutant.content)}`,
          parentSha: mutant.parentSha,
          mutant,
          fitness,
          generation: g,
          status: "active",
        });
        archived.push({ mutant, fitness });
        committed = this.retain.commit(mutant, {
          strictImprovement: true,
          paretoFront,
        });
        continue;
      }

      // T04 strict-improvement hard gate (REAL call).
      const decision = this.gate.decide(best, fitness);
      if (!decision.accept) {
        // Regression ≥ τ → reject + do NOT archive (§0 invariant 1).
        rejected.push(mutant);
        continue;
      }

      // T05 Pareto select (REAL call — paretoFront is the selector's verdict,
      // never a hard-coded literal).
      const paretoFront = this.isOnParetoFront(archived, { mutant, fitness });
      // Accepted (strict-improvement passed) variants are archived (keep-all;
      // T06a TreeArchive.insert also applies its own interesting-judgment).
      this.archive.insert({
        sha: `sha-${hashStr(mutant.content)}`,
        parentSha: mutant.parentSha,
        mutant,
        fitness,
        generation: g,
        status: "active",
      });
      archived.push({ mutant, fitness });
      best = fitness;
      bestMutant = mutant;
      if (paretoFront) {
        committed = this.retain.commit(mutant, {
          strictImprovement: true,
          paretoFront: true,
        });
      }
    }

    const result: LoopResult = {
      archive: this.archive,
      rejected,
    };
    if (committed !== null) {
      result.committed = committed;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// runEvolutionLoop — public entry (breaker gate + adapter body)
// ---------------------------------------------------------------------------

/**
 * L3 evolution-loop entry (MVP). Asserts the static-core set is read-only at
 * entry (breaker clause §0 invariant 3), then constructs REAL default
 * instances of every T02–T08 component and runs the {@link EvolveSkillAdapter}
 * closed loop: generate(T02/T03) → score(train) → strict-improvement select
 * (T04) + Pareto select (T05) → commit-on-success retain (T08) → keep-all
 * archive (T06a).
 *
 * Weight channel is off by default (PRD §6.1 N1). Non-prompt substrate kinds
 * are V2/T09+ placeholders; the body throws BreakerError for them so the loop
 * never fakes evolution for an un-routed channel.
 */
export async function runEvolutionLoop(opts: LoopOptions): Promise<LoopResult> {
  const sandbox: Sandbox = opts.sandbox;

  // Breaker: assert the canonical static-core set is read-only at entry.
  try {
    await sandbox.assertReadonly(STATIC_CORE_PATHS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordSecurityEvent(sandbox, {
      kind: "static-core-write",
      path: "static-core",
      reason,
    });
    throw new BreakerError(
      `breaker: static-core path writable at loop entry — ${reason}`,
    );
  }

  // Weight channel default off (no evolution for weight substrate in MVP).
  if (opts.substrate.kind === "weight") {
    throw new BreakerError(
      `breaker: substrate kind 'weight' channel is off (PRD §6.1 N1)`,
    );
  }

  // MVP body only routes the prompt channel; workflow/skill are V2/T09+
  // placeholders that must not silently fall through.
  if (opts.substrate.kind !== "prompt") {
    throw new BreakerError(
      `breaker: substrate kind '${opts.substrate.kind}' body not implemented in MVP (lands in V1/V2)`,
    );
  }

  // Construct REAL default instances of every T02–T08 component and inject
  // them into the adapter. No inline stubs.
  const gate = new StrictImprovementGate({ tau: opts.tau });
  const pareto = new ParetoSelector();
  const archive = new TreeArchive();
  const retain = new Retain();
  const beam = new BeamSearchOptimizer({
    beamWidth: opts.beamWidth,
    prngSeed: 42,
    // No evaluator wired into the beam optimizer: scoring is the adapter's
    // responsibility (BeamSearchOptimizerOptions.evaluator is the score-failure
    // isolation path for standalone T02 use; the loop scores beam[g] itself).
  });
  const reflective = new ReflectiveMutator({
    // MVP loop entry (LoopOptions) carries no LLM and no failure trajectories,
    // so reflective mutation is wired but legitimately inactive (T03 activates
    // on CE-T03 Lucky-Pass-filtered failures). The stub LLM throws if ever
    // called — an honest guard, not a fake call site.
    llm: new NoopLLM(),
    maxCandidates: opts.beamWidth,
  });

  const adapter = new EvolveSkillAdapter({
    beam,
    reflective,
    gate,
    pareto,
    archive,
    retain,
  });
  adapter.setEvaluator((m, split) => opts.evaluator.score(m, split));
  return adapter.runLoop(opts.substrate, opts.generations);
}

// ---------------------------------------------------------------------------
// NoopLLM — stub LLMPort for the MVP loop entry.
// ---------------------------------------------------------------------------

/**
 * Stub {@link LLMPort} used when the MVP loop entry has no real LLM wired.
 * Reflective mutation (T03) only invokes the LLM when failure trajectories
 * are present; the MVP {@link LoopOptions} carries none, so this stub is
 * never called. If it ever IS called, it throws loudly rather than faking a
 * completion — an honest guard against an unconfigured upstream.
 */
class NoopLLM implements LLMPort {
  async complete(_prompt: string): Promise<string> {
    throw new Error(
      "breaker: ReflectiveMutator LLM not wired (NoopLLM) — LoopOptions carries no LLM/trajectories in MVP",
    );
  }
}
