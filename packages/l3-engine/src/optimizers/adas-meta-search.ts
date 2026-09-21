// L3-T13: ADAS / Meta Agent Search optimizer [V1].
//
// Spec: execution/L3-engine/TASKS.md §L3-T13.
//
// A meta-agent reads a *growing* archive (agent code + scores, T06a
// DGM open-tree keep-all backend) → few-shot samples high-fitness +
// high-diversity agents → writes a new agent's skill code in the
// Turing-complete DSL (AgentDSL) → the result is scored and archived by
// the caller loop. Substrate = skill code (Voyager-style executable
// skill body).
//
// Breaker clause: the produced DSL code is validated by AgentDSL before
// being trusted; eval/exec/network flags are rejected (inherited from
// L2-T09b, see ./dsl-validator.ts). ADAS-written skill code is staging +
// human-signed by default (Voyager commit-on-success); this optimizer does
// NOT bypass the breaker.
//
// Invariants:
//   - archive growth never decreases (keep-all, T06a) — we never delete;
//     archiving itself is the loop's job, but sampleArchive reads all
//     entries (active + retired) so retired-but-kept entries remain
//     sampleable (growing archive open-ended).
//   - cold start (archive empty) → returns at most one zero-shot Mutant.

import type {
  Substrate,
  Mutant,
  ArchiveEntry,
  OptContext,
  Optimizer,
} from "../types.js";
import type { LLMPort } from "../reflective-mutation.js";
import { TreeArchive } from "../archive/tree-archive.js";
import { hashStr } from "../prng.js";

export interface AdasMetaSearchOptimizerOptions {
  llm: LLMPort;
  archive: TreeArchive;
  sampleK: number;
  seed: number;
}

// ---------------------------------------------------------------------------
// TreeArchive enumeration.
//
// TreeArchive (T06a) keeps its entries in a private `Map<sha, ArchiveEntry>`
// and exposes only `insert` / `rollback` / `size` / `retire` /
// `queryNonDominated`. There is no public "list all" accessor, and the
// same-package-prior-file rule forbids editing tree-archive.ts. ADAS
// sampleArchive, however, MUST be able to sample from the *entire* growing
// archive (active + retired — retired entries remain sampleable per
// keep-all, see spec invariant "archived entry can be re-sampled"). We
// therefore read the private map via a structural cast (TS `private` is
// compile-time only; the field exists at runtime) and fall back to the
// public non-dominated front if the field is absent.
// ---------------------------------------------------------------------------

function getAllEntries(archive: TreeArchive): ArchiveEntry[] {
  const a = archive as unknown as {
    entries?: Map<string, ArchiveEntry>;
    queryNonDominated?: () => ArchiveEntry[];
  };
  if (a.entries instanceof Map) {
    return Array.from(a.entries.values());
  }
  if (typeof a.queryNonDominated === "function") {
    return a.queryNonDominated();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Fitness + diversity scoring.
//
// Fitness is multi-objective (resolve_rate ∧ token ∧ cache_hit, NO weighted
// sum per T05/T06a). For *sampling* (selection, not selection-of-survivors)
// we collapse to a single greedy priority that respects direction pins:
//   resolve_rate: higher = better
//   cache_hit:    higher = better
//   token:        lower  = better (flipped)
// This is a sampling heuristic, not a Pareto verdict — the actual select
// step (T04/T05) remains Pareto-gated. Diversity is content-distance based
// (hash distance as a cheap proxy) so high-diversity agents are preferred
// alongside high fitness, matching ADAS "few-shot high-score + high-diversity".
// ---------------------------------------------------------------------------

function fitnessScore(e: ArchiveEntry): number {
  const f = e.fitness;
  // token lower = better → invert so "bigger = better".
  const tokenScore = -f.token;
  return f.resolve_rate + f.cache_hit + 0.001 * tokenScore;
}

function contentDistance(a: ArchiveEntry, b: ArchiveEntry): number {
  // Normalised hash distance ∈ [0, 1) as a cheap content-diversity proxy.
  const ha = hashStr(a.mutant.content ?? "");
  const hb = hashStr(b.mutant.content ?? "");
  return Math.abs(ha - hb) / 4294967296;
}

let _mutantCounter = 0;
function nextMutantId(prefix = "adas"): string {
  return `${prefix}-${++_mutantCounter}`;
}

// ---------------------------------------------------------------------------
// AdasMetaSearchOptimizer.
// ---------------------------------------------------------------------------

export class AdasMetaSearchOptimizer implements Optimizer {
  private readonly llm: LLMPort;
  private readonly archive: TreeArchive;
  private readonly sampleK: number;
  private readonly seed: number;

  constructor(opts: AdasMetaSearchOptimizerOptions) {
    this.llm = opts.llm;
    this.archive = opts.archive;
    this.sampleK = opts.sampleK;
    this.seed = opts.seed;
  }

  /**
   * Sample `k` high-fitness + high-diversity entries from the growing
   * archive. Deterministic for a fixed (archive, k, seed) triple: a greedy
   * selector with fitness-first pick then fitness+diversity picks, stable
   * (sha asc) tiebreak. Reads active + retired entries (keep-all: retired
   * entries remain sampleable).
   */
  sampleArchive(archive: TreeArchive, k: number, seed: number): ArchiveEntry[] {
    const all = getAllEntries(archive);
    if (all.length === 0 || k <= 0) return [];
    if (all.length <= k) {
      // Return all, deterministically ordered by fitness desc then sha asc.
      const sorted = [...all].sort(
        (a, b) =>
          fitnessScore(b) - fitnessScore(a) || a.sha.localeCompare(b.sha),
      );
      return sorted;
    }

    const pool = [...all].sort(
      (a, b) => fitnessScore(b) - fitnessScore(a) || a.sha.localeCompare(b.sha),
    );

    const selected: ArchiveEntry[] = [pool.shift()!]; // highest fitness first

    while (selected.length < k && pool.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i]!;
        let diversity = Infinity;
        for (const s of selected) {
          const d = contentDistance(candidate, s);
          if (d < diversity) diversity = d;
        }
        const score = fitnessScore(candidate) + 0.5 * diversity;
        // stable tiebreak: sha asc (seed accepted per signature; tiebreak is
        // purely deterministic here so re-runs yield identical ids).
        if (
          score > bestScore ||
          (score === bestScore && pool[i]!.sha < pool[bestIdx]!.sha)
        ) {
          bestScore = score;
          bestIdx = i;
        }
      }
      selected.push(pool.splice(bestIdx, 1)[0]!);
    }

    // seed is part of the contract; referenced to keep the signature honest
    // (the deterministic selector above is seed-independent — re-running with
    // the same archive+k yields the same ids, satisfying the determinism test).
    void seed;
    return selected;
  }

  /**
   * Ask the LLM (meta-agent) to write a NEW skill in the DSL, given the
   * parent and few-shot high-score sample agents. Returns a Mutant with
   * `origin='reflective'` and `parentSha=parent.sha`.
   */
  async proposeAgent(
    parent: ArchiveEntry,
    samples: ArchiveEntry[],
  ): Promise<Mutant> {
    const fewShot = samples
      .map((s) => {
        const f = s.fitness;
        return `// resolve_rate=${f.resolve_rate} token=${f.token} cache_hit=${f.cache_hit}\n${s.mutant.content}`;
      })
      .join("\n---\n");

    const prompt = [
      "You are an ADAS meta-agent.",
      "Given a parent skill and high-scoring sample agents, write a NEW skill",
      "in the agent DSL (a Turing-complete JS subset: functions, control flow,",
      "tool calls). The breaker clause forbids eval(), network egress, and",
      "subprocess exec/spawn — do not use them.",
      "",
      "Parent skill:",
      parent.mutant.content,
      "",
      "Sample agents (high fitness + high diversity, few-shot):",
      fewShot || "(none)",
      "",
      "Output ONLY the new skill code. No prose, no markdown fences.",
    ].join("\n");

    const code = await this.llm.complete(prompt);
    return {
      id: nextMutantId(),
      parentSha: parent.sha,
      content: code ?? "",
      origin: "reflective",
    };
  }

  /**
   * Generate mutants for a skill substrate.
   *
   * - archive empty → cold start: at most one zero-shot Mutant (LLM produces
   *   a starter skill with no few-shot context). Never throws.
   * - otherwise → sample archive (sampleK, seed), pick the highest-fitness
   *   sample as parent, ask the meta-agent to propose a new skill, return
   *   `[mutant]`.
   */
  async generate(substrate: Substrate, _ctx: OptContext): Promise<Mutant[]> {
    const samples = this.sampleArchive(this.archive, this.sampleK, this.seed);

    if (samples.length === 0) {
      // cold start — zero-shot
      const prompt = [
        "You are an ADAS meta-agent in cold-start mode (archive empty).",
        "Write a starter skill in the agent DSL (Turing-complete JS subset).",
        "The breaker clause forbids eval(), network egress, subprocess exec/spawn.",
        "",
        "Substrate kind:",
        substrate.kind,
        "",
        "Output ONLY the new skill code. No prose, no markdown fences.",
      ].join("\n");
      const code = await this.llm.complete(prompt);
      if (!code || code.trim().length === 0) return [];
      return [
        {
          id: nextMutantId(),
          parentSha: substrate.sha,
          content: code,
          origin: "reflective",
        },
      ];
    }

    const parent = samples[0]!; // highest fitness (sampleArchive picks fitness-first)
    const mutant = await this.proposeAgent(parent, samples);
    return [mutant];
  }
}
