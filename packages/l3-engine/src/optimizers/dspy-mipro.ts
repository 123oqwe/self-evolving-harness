// L3-T11: DSPy/MIPROv2 instruction×demo factorize optimiser with mini-batch
// Bayesian surrogate + train/val split.
//
// Spec: execution/L3-engine/TASKS.md §L3-T11.
//
// Two core mechanisms (from DSPy/MIPROv2, 03-skills.md §2.3 ★★★★☆ —
// borrowed, NOT integrated; no upstream repo):
//   (1) factorize — decouple instruction-segment mutation from demo-segment
//       mutation, then cross-combine (cartesian product).
//   (2) mini-batch Bayesian surrogate — proxy expensive canary rollouts with
//       a random-forest regressor; train/val split prevents overfitting the
//       surrogate to held-out validation fitness.
//
// Scope: prompt substrates ONLY. `workflow` / `weight` substrates raise
// `NotImplementedError` (weight-channel + workflow-channel optimisers are
// V2 placeholders). The strict-improvement + held-out gate still guards the
// downstream select step; this optimiser only produces candidates.

import type {
  Optimizer,
  OptContext,
  Substrate,
  Mutant,
} from "../types.js";
import type { LLMPort } from "../reflective-mutation.js";
import { BayesianSurrogate } from "./bayesian-surrogate.js";
import { factorizeInstructionDemo } from "./instruction-demo-factorize.js";

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/**
 * Raised when `generate` is called on a non-prompt substrate
 * (`workflow` / `weight`). DSPy/MIPROv2 factorize only applies to prompt
 * substrates (instruction + demo segments are prompt concepts); weight and
 * workflow channels are V2 placeholders (L3-T15 weight-channel spec).
 *
 * Named `NotImplementedError` per the L3-T11 RED contract (distinct from the
 * L3-T01 `NotImplemented` breaker clause which guards the optimiser router).
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

// ---------------------------------------------------------------------------
// Options.
// ---------------------------------------------------------------------------

export interface DspyMiproOptimizerOptions {
  llm: LLMPort;
  surrogate: BayesianSurrogate;
  /** Train fraction for the internal train/val split (e.g. 0.7). */
  trainSplit: number;
  seed: number;
  /** Max instruction variants per `proposeInstruction` call. */
  instructionsPerCall?: number;
  /** Max demo variants per `proposeDemo` call. */
  demosPerCall?: number;
}

// LLM reply contract: a JSON array of `{ content: string }`.
interface SegmentCandidate {
  content?: unknown;
}

// ---------------------------------------------------------------------------
// DspyMiproOptimizer.
// ---------------------------------------------------------------------------

export class DspyMiproOptimizer implements Optimizer {
  private readonly llm: LLMPort;
  private readonly surrogate: BayesianSurrogate;
  private readonly trainSplit: number;
  private readonly seed: number;
  private readonly instructionsPerCall: number;
  private readonly demosPerCall: number;

  constructor(opts: DspyMiproOptimizerOptions) {
    this.llm = opts.llm;
    this.surrogate = opts.surrogate;
    this.trainSplit = opts.trainSplit;
    this.seed = opts.seed;
    this.instructionsPerCall = opts.instructionsPerCall ?? 3;
    this.demosPerCall = opts.demosPerCall ?? 3;
  }

  // -------------------------------------------------------------------------
  // generate — factorize cartesian product.
  // -------------------------------------------------------------------------

  /**
   * Produce the crossed instruction×demo candidate set for a prompt
   * substrate.
   *
   *  - `workflow` / `weight` substrate → `NotImplementedError` (prompt-only).
   *  - prompt/skill substrate → `proposeInstruction` × `proposeDemo` crossed
   *    via the factorize combiner (≥ `instrCount × demoCount` candidates,
   *    each `origin='reflective'`, `parentSha=substrate.sha`).
   *
   * The internal train/val split is applied by the caller when scoring
   * candidates; the surrogate consumes only `split='train'` fitness (the
   * `TrainValLeak` guard in `BayesianSurrogate.fit` enforces the gate).
   */
  async generate(
    substrate: Substrate,
    _ctx: OptContext,
  ): Promise<Mutant[]> {
    this.assertPromptOnly(substrate);

    const [instr, demos] = await Promise.all([
      this.proposeInstruction(substrate),
      this.proposeDemo(substrate),
    ]);

    return factorizeInstructionDemo(substrate.sha, instr, demos);
  }

  // -------------------------------------------------------------------------
  // proposeInstruction — mutate ONLY the instruction segment.
  // -------------------------------------------------------------------------

  /**
   * Ask the LLM to rewrite the instruction segment of the substrate. Returns
   * up to `instructionsPerCall` `Mutant`s (`origin='reflective'`,
   * `parentSha=substrate.sha`). The demo segment is left untouched.
   */
  async proposeInstruction(parent: Substrate): Promise<Mutant[]> {
    return this.proposeSegment(parent, "instruction", this.instructionsPerCall);
  }

  // -------------------------------------------------------------------------
  // proposeDemo — mutate ONLY the few-shot demo segment.
  // -------------------------------------------------------------------------

  /**
   * Ask the LLM to rewrite the few-shot demo segment of the substrate.
   * Returns up to `demosPerCall` `Mutant`s (`origin='reflective'`,
   * `parentSha=substrate.sha`). The instruction segment is left untouched.
   */
  async proposeDemo(parent: Substrate): Promise<Mutant[]> {
    return this.proposeSegment(parent, "demo", this.demosPerCall);
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private async proposeSegment(
    parent: Substrate,
    segment: "instruction" | "demo",
    max: number,
  ): Promise<Mutant[]> {
    const prompt = [
      `## DSPy/MIPROv2 factorize — ${segment} segment mutation`,
      `Substrate (sha=${parent.sha}):`,
      "```",
      parent.content,
      "```",
      "",
      `Produce at most ${max} rewritten ${segment} variants. Reply with ONLY a JSON array of objects of shape {"content": string}. No prose.`,
    ].join("\n");

    const reply = await this.llm.complete(prompt);
    return this.parseSegmentReply(reply, parent.sha, max);
  }

  private parseSegmentReply(
    reply: string,
    parentSha: string,
    max: number,
  ): Mutant[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const out: Mutant[] = [];
    for (let i = 0; i < parsed.length && out.length < max; i++) {
      const c = parsed[i] as SegmentCandidate;
      if (c == null || typeof c !== "object") continue;
      const content = c.content;
      if (typeof content !== "string" || content.length === 0) continue;
      out.push({
        id: `mipro-${out.length}`,
        parentSha,
        content,
        origin: "reflective",
      });
    }
    return out;
  }

  private assertPromptOnly(substrate: Substrate): void {
    if (substrate.kind === "workflow" || substrate.kind === "weight") {
      throw new NotImplementedError(
        `L3-T11: DspyMiproOptimizer only supports prompt substrates (got kind='${substrate.kind}'); workflow/weight channels are V2 placeholders`,
      );
    }
  }

  // Expose the configured train split for caller-side scoring (the surrogate
  // itself only enforces the split==='train' leak guard).
  get configuredTrainSplit(): number {
    return this.trainSplit;
  }

  get configuredSeed(): number {
    return this.seed;
  }

  get configuredSurrogate(): BayesianSurrogate {
    return this.surrogate;
  }
}
