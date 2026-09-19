// L3-T03: reflective mutation 生成器（GEPA 变异来源） [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T03.
//
// The optimizer LLM reads aggregated failure-trajectory diagnoses and
// rewrites the substrate to produce mutation candidates. Input trajectories
// MUST already have passed CE-T03 AgentLens Lucky-Pass filtering; this
// module still re-checks the `luckyPass` flag at the entry as
// defence-in-depth (guards against upstream CE-T03 filtering leakage).
//
// No real LLM call here — the `LLMPort` is a port; tests inject a FakeLLM.
// The real LLMPort adapter (AgentSession-backed) lands in L1-T04a.

import type { Substrate, Mutant, Trajectory } from "./types.js";
import { readReflectivePrompt } from "./prompts/reflective-mutation.js";

// ---------------------------------------------------------------------------
// LLMPort — a minimal completion port (test FakeLLM satisfies this).
// ---------------------------------------------------------------------------

/**
 * Minimal LLM completion port. `complete(prompt)` returns the model's text
 * reply. The reflective mutator expects a JSON array of mutation candidates.
 */
export interface LLMPort {
  complete(prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/**
 * Raised when an input trajectory carries `luckyPass === true`. Lucky-pass
 * trajectories must NEVER feed reflective mutation (they represent blind
 * retry passes, not genuine failure diagnoses). This is a safety contract
 * — CE-T03 filters them upstream, but this guard is defence-in-depth
 * against upstream filtering leakage.
 */
export class LuckyPassTrajectoryRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LuckyPassTrajectoryRejected";
  }
}

/**
 * Raised when the LLM reply is not a parseable JSON array of mutation
 * candidates, or when a parsed candidate has no `content` (i.e. the
 * mutation is unrelated to the parent substrate). Records the raw reply on
 * the instance for diagnosis.
 */
export class MalformedMutation extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "MalformedMutation";
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// Parsed mutation candidate shape (LLM reply contract).
// ---------------------------------------------------------------------------

interface MutationCandidate {
  content?: unknown;
}

// ---------------------------------------------------------------------------
// ReflectiveMutator — GEPA reflective mutation generator.
// ---------------------------------------------------------------------------

export interface ReflectiveMutatorOptions {
  llm: LLMPort;
  /** Upper bound on candidates returned per `mutate` call. */
  maxCandidates: number;
}

export class ReflectiveMutator {
  private readonly llm: LLMPort;
  private readonly maxCandidates: number;

  constructor(opts: ReflectiveMutatorOptions) {
    this.llm = opts.llm;
    this.maxCandidates = opts.maxCandidates;
  }

  /**
   * Read aggregated failure trajectories → ask the LLM to rewrite the
   * substrate → parse the JSON reply into `Mutant[]` with
   * `origin='reflective'` and `parentSha=substrate.sha`.
   *
   * Behaviour:
   *  - Any trajectory with `luckyPass === true` → `LuckyPassTrajectoryRejected`
   *    (defence-in-depth; checked BEFORE the LLM call so no blind-retry
   *    trajectory ever reaches the model).
   *  - Empty failures → returns `[]` immediately (no reflection source;
   *    no LLM call).
   *  - Non-JSON / unparseable reply / candidate without `content` →
   *    `MalformedMutation`.
   */
  async mutate(substrate: Substrate, failures: Trajectory[]): Promise<Mutant[]> {
    // Boundary: no reflection source → no candidates, no LLM call.
    if (failures.length === 0) return [];

    // Defence-in-depth luckyPass guard (CE-T03 filters upstream; this
    // catches leakage).
    for (const t of failures) {
      if (t.luckyPass === true) {
        throw new LuckyPassTrajectoryRejected(
          `L3-T03: trajectory ${t.id} carries luckyPass=true — blind-retry trajectories must not feed reflective mutation`,
        );
      }
    }

    const prompt = buildPrompt(substrate, failures, this.maxCandidates);
    const reply = await this.llm.complete(prompt);

    let parsed: unknown;
    try {
      parsed = JSON.parse(reply);
    } catch {
      throw new MalformedMutation(
        "L3-T03: LLM reply was not valid JSON",
        reply,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new MalformedMutation(
        "L3-T03: LLM reply JSON was not an array of mutation candidates",
        reply,
      );
    }

    const out: Mutant[] = [];
    for (let i = 0; i < parsed.length && out.length < this.maxCandidates; i++) {
      const candidate = parsed[i] as MutationCandidate;
      if (candidate == null || typeof candidate !== "object") {
        throw new MalformedMutation(
          `L3-T03: mutation candidate[${i}] is not an object`,
          reply,
        );
      }
      const content = candidate.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new MalformedMutation(
          `L3-T03: mutation candidate[${i}] has no string \`content\` (mutation unrelated to parent)`,
          reply,
        );
      }
      out.push({
        id: `r-${i}`,
        parentSha: substrate.sha,
        content,
        origin: "reflective",
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder — assembles the LLM prompt from substrate + diagnoses.
// The template text lives in src/prompts/reflective-mutation.md (REFACTOR:
// externalised for L1 substrate-evolution loop reuse).
// ---------------------------------------------------------------------------

function buildPrompt(
  substrate: Substrate,
  failures: Trajectory[],
  maxCandidates: number,
): string {
  const template = readReflectivePrompt();
  const diagnoses = failures
    .map((t) => `- [${t.id}] (session=${t.sessionId}) ${t.diagnosis}`)
    .join("\n");
  return [
    template,
    "",
    `## Substrate (kind=${substrate.kind}, sha=${substrate.sha})`,
    "```",
    substrate.content,
    "```",
    "",
    `## Failure trajectories (${failures.length})`,
    diagnoses,
    "",
    `## Instruction`,
    `Produce at most ${maxCandidates} rewritten substrate variants that address the failure diagnoses above. Reply with ONLY a JSON array of objects of shape {"content": string}. No prose.`,
  ].join("\n");
}
