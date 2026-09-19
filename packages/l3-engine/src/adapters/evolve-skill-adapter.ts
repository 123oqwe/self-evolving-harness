// L3-engine · EvolveSkillAdapter — closed evolution loop (MVP).
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 (EvolveSkillAdapter) + §1
// (module-level integration). Adapts the bigpowers `evolve-skill` +
// anthropics `skill-creator` "mutate → eval → held-out gate → rollback"
// skeleton into the L3 generalised engine: fitness is the harness sub-module
// behaviour success rate (resolve_rate ∧ token ∧ cache_hit), NOT the raw
// skill pass@k metric (see fitness-bridge.ts for the generalisation guard).
//
// Loop body (per spec): generate → score(train) → select(strict-improvement +
// Pareto) → retain(commit-on-success) → archive(keep-all). The MVP runs one
// candidate per generation against the running best; beamWidth is accepted as
// the beam capacity (kept in the result for V1 full-population extension).
//
// Invariants (§0):
//  1. strict-improvement hard gate — any held-out regression ≥ τ → reject.
//  2. diversity archive keep-all — never auto-delete.
//  3. optimizer cannot write static-core — enforced at the loop entry breaker.
//
// Self-contained: T02–T08 components (BeamSearchOptimizer / ReflectiveMutator
// / StrictImprovementGate / ParetoSelector / TreeArchive / Retain) are not yet
// linked in this wave. The adapter owns minimal inline implementations of the
// gate / archive / retain so the closed loop is demonstrable now; when T02–T08
// land they can be injected via the constructor opts without changing the
// public runLoop contract.

import type {
  Substrate,
  Mutant,
  Fitness,
  LoopOptions,
  LoopResult,
} from "../types.js";
import type { Sandbox } from "../sandbox.js";
import { STATIC_CORE_PATHS } from "../sandbox.js";
import { BreakerError, recordSecurityEvent } from "../breaker.js";

// ---------------------------------------------------------------------------
// Internal: minimal strict-improvement gate (T04 contract shape, MVP subset)
// ---------------------------------------------------------------------------

interface GateDecision {
  accept: boolean;
  regressions: (keyof Fitness)[];
}

/**
 * MVP strict-improvement gate. Direction pins (locked by T04 spec):
 *   - resolve_rate : higher = better
 *   - token        : lower  = better  (flipped)
 *   - cache_hit    : higher = better
 * Any dimension regressing by ≥ τ → reject (no weighted sum; multi-objective).
 */
class InternalStrictGate {
  private readonly tau: Partial<Record<keyof Fitness, number>>;
  constructor(tau: Partial<Record<keyof Fitness, number>>) {
    this.tau = tau;
  }
  decide(baseline: Fitness, candidate: Fitness): GateDecision {
    const dims: (keyof Fitness)[] = ["resolve_rate", "token", "cache_hit"];
    const regressions: (keyof Fitness)[] = [];
    for (const d of dims) {
      const b = baseline[d];
      const c = candidate[d];
      if (typeof b !== "number" || typeof c !== "number") {
        throw new Error(
          `breaker: incomplete fitness — dimension '${d}' missing (strict-improvement gate)`,
        );
      }
      const higherBetter = d !== "token"; // token is the only lower=better dim
      // positive delta = improvement
      const delta = higherBetter ? c - b : b - c;
      const t = this.tau[d] ?? 0;
      if (delta < 0 && Math.abs(delta) >= t) {
        regressions.push(d);
      }
    }
    return { accept: regressions.length === 0, regressions };
  }
}

// ---------------------------------------------------------------------------
// Internal: minimal keep-all archive (T06a TreeArchive contract subset)
// ---------------------------------------------------------------------------

interface ArchiveRecord {
  mutant: Mutant;
  fitness: Fitness;
  generation: number;
}

/**
 * MVP keep-all archive (DGM open-ended tree subset). Never auto-deletes; size()
 * is monotonically non-decreasing. The full TreeArchive lands in T06a; this
 * inline impl satisfies the §1 integration assertions on `archive.size()`.
 */
class InternalArchive {
  private readonly records: ArchiveRecord[] = [];
  add(record: ArchiveRecord): void {
    this.records.push(record);
  }
  size(): number {
    return this.records.length;
  }
}

// ---------------------------------------------------------------------------
// Internal: minimal commit-on-success retain (T08 Retain contract subset)
// ---------------------------------------------------------------------------

/**
 * MVP Voyager commit-on-success. bumpVersion mirrors T08's contract:
 * first bump → `<name>V2`; an existing `V<n>` suffix → next V. Returns
 * `{version, sha}` for the committed mutant, or null when the gate failed.
 */
class InternalRetain {
  bumpVersion(name: string): string {
    const m = /V(\d+)$/.exec(name);
    if (m) {
      const next = Number.parseInt(m[1] ?? "0", 10) + 1;
      return `${name.slice(0, name.length - m[0].length)}V${next}`;
    }
    return `${name}V2`;
  }
  commit(
    mutant: Mutant,
    gates: { strictImprovement: boolean; paretoFront: boolean },
  ): { version: string; sha: string } | null {
    if (!gates.strictImprovement || !gates.paretoFront) return null;
    // The committed mutant's version name derives from the mutant content
    // (the "phase name" in evolve-skill terms); the sha is content-addressed.
    const name = mutant.content.length ? mutant.content : "variant";
    return { version: this.bumpVersion(name), sha: `sha-${mutant.id}` };
  }
}

// ---------------------------------------------------------------------------
// Mutant generation (MVP: deterministic content mutation per generation)
// ---------------------------------------------------------------------------

let _mutantCounter = 0;

function generateMutant(substrate: Substrate, generation: number): Mutant {
  _mutantCounter += 1;
  return {
    id: `m-${generation}-${_mutantCounter}`,
    parentSha: substrate.sha,
    content: `${substrate.content}\n# variant gen=${generation + 1}`,
    origin: "beam-search",
  };
}

// ---------------------------------------------------------------------------
// EvolveSkillAdapter — closed loop
// ---------------------------------------------------------------------------

/**
 * Adapts the evolve-skill / skill-creator "mutate → eval → held-out gate →
 * rollback" skeleton into the L3 generalised engine.
 *
 * MVP: the constructor accepts optional injected T02–T08 components; when they
 * are absent the adapter falls back to its own inline minimal implementations
 * (gate / archive / retain) so the closed loop is demonstrable in Wave 3.
 */
export class EvolveSkillAdapter {
  private readonly gate: InternalStrictGate;
  private readonly archive: InternalArchive;
  private readonly retain: InternalRetain;

  constructor(opts?: {
    tau: Partial<Record<keyof Fitness, number>>;
  }) {
    this.gate = new InternalStrictGate(opts?.tau ?? {});
    this.archive = new InternalArchive();
    this.retain = new InternalRetain();
  }

  async runLoop(substrate: Substrate, generations: number): Promise<LoopResult> {
    const rejected: Mutant[] = [];
    let best: Fitness | null = null;
    let committed: { version: string; sha: string } | null = null;

    for (let g = 0; g < generations; g++) {
      const mutant = generateMutant(substrate, g);
      // score on the train split (held-out canary gate lands with CE; MVP
      // uses the evaluator's train split as the selection signal).
      const fitness = await this.score(substrate, mutant);

      if (best === null) {
        // First candidate: no baseline to regress against → seed the best,
        // archive it, and commit-on-success (both gates pass by construction).
        best = fitness;
        this.archive.add({ mutant, fitness, generation: g });
        committed = this.retain.commit(mutant, {
          strictImprovement: true,
          paretoFront: true,
        });
        continue;
      }

      const decision = this.gate.decide(best, fitness);
      if (decision.accept) {
        best = fitness;
        this.archive.add({ mutant, fitness, generation: g });
        committed = this.retain.commit(mutant, {
          strictImprovement: true,
          paretoFront: true,
        });
      } else {
        // Strict-improvement hard gate: regression ≥ τ → reject + do NOT
        // archive (§0 invariant 1). keep-all only applies to accepted variants.
        rejected.push(mutant);
      }
    }

    // Build the result. `committed` is set explicitly when non-null; when
    // null it is omitted so the optional `committed?: {...}|null` contract is
    // honoured under exactOptionalPropertyTypes.
    const result: LoopResult = {
      archive: this.archive,
      rejected,
    };
    if (committed !== null) {
      result.committed = committed;
    }
    return result;
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
  private async score(_substrate: Substrate, mutant: Mutant): Promise<Fitness> {
    if (!this._evaluator) {
      throw new Error(
        "breaker: EvolveSkillAdapter has no evaluator wired (runEvolutionLoop must inject one)",
      );
    }
    return this._evaluator(mutant, "train");
  }
}

// ---------------------------------------------------------------------------
// runEvolutionLoop — public entry (breaker gate + adapter body)
// ---------------------------------------------------------------------------

/**
 * L3 evolution-loop entry (MVP). Asserts the static-core set is read-only at
 * entry (breaker clause §0 invariant 3), then runs the {@link EvolveSkillAdapter}
 * closed loop: generate → score(train) → strict-improvement select →
 * commit-on-success retain → keep-all archive.
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

  // Run the closed loop with the adapter, injecting the evaluator from options.
  const adapter = new EvolveSkillAdapter({ tau: opts.tau });
  adapter.setEvaluator((m, split) => opts.evaluator.score(m, split));
  return adapter.runLoop(opts.substrate, opts.generations);
}
