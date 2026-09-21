// L3-T12: TextGrad per-variable 文本梯度适配 [V1] (MVP).
//
// Spec: execution/L3-engine/TASKS.md §L3-T12.
// Algorithm: 03-skills.md §2.3 ★★★☆☆ (借鉴, 不集成 — no upstream repo).
//
// TextGrad's text autograd: a failure trajectory → per-variable text
// gradients (improvement suggestions) → reverse-propagate into each
// optimisable variable of the substrate → rewrite. The defining
// difference vs L3-T03 reflective mutation (which produces whole
// candidate rewrites) is PER-VARIABLE ISOLATION: each variable gets its
// own independent gradient, and a gradient on variable A must never
// change variable B's content.
//
// Scope: prompt / skill substrates ONLY. `weight` substrates raise
// `NotImplementedError` (weight-channel optimiser is a V2 placeholder,
// L3-T15). Lucky-pass trajectories are rejected at the entry as
// defence-in-depth (inherited L3-T03 contract; CE-T03 filters upstream).
//
// MVP note (per spec "执行提示 (2)" + "借鉴, 不集成"): the real TextGrad
// reverse pass issues one LLM call per variable to obtain that variable's
// gradient. The L3 `LLMPort.complete` is asynchronous, so a genuine
// per-variable LLM gradient call belongs in an async reverse pass (V2).
// For V1 the gradient source is `TextLoss.perVar` (the per-variable
// feedback channel populated upstream by trajectory diagnosis) with a
// deterministic feedback-routing fallback so the optimiser still produces
// isolated per-variable candidates without an LLM round-trip. The `llm`
// is wired in the constructor for the V2 async reverse pass; the per-
// variable isolation contract (the actual tested invariant) is enforced
// here regardless of gradient source.

import type {
  Optimizer,
  OptContext,
  Substrate,
  Mutant,
  Trajectory,
} from "../types.js";
import type { LLMPort } from "../reflective-mutation.js";
import { LuckyPassTrajectoryRejected } from "../reflective-mutation.js";
import { NotImplementedError } from "./dspy-mipro.js";
import { parseVariables, assembleContent } from "./variable-parser.js";

// ---------------------------------------------------------------------------
// Public contract types (spec interface signatures).
// ---------------------------------------------------------------------------

/**
 * A single optimisable variable inside a prompt/skill substrate. Each
 * variable receives its own independent text gradient during the reverse
 * pass; gradients NEVER cross variable boundaries (per-variable isolation).
 */
export interface TextGradVariable {
  id: string;
  content: string;
  role: "instruction" | "demo" | "description";
}

/**
 * A per-variable text gradient: an improvement suggestion targeting exactly
 * one variable (`varId`). An empty `suggestion` means "no gradient for this
 * variable" — `applyGradients` leaves that variable unchanged.
 */
export interface TextGrad {
  varId: string;
  suggestion: string;
}

/**
 * Loss surface for the TextGrad reverse pass. `feedback` is the aggregate
 * failure diagnosis (used by the MVP feedback-routing fallback when no
 * per-variable feedback is available). `perVar` is the per-variable
 * feedback map (the real LLM-produced gradient channel) keyed by variable
 * id. `trajectoryId` ties the loss to its source trajectory.
 */
export interface TextLoss {
  trajectoryId: string;
  feedback: string;
  perVar?: Record<string, string>;
}

/**
 * Constructor options. `llm` is the completion port (wired for the V2 async
 * per-variable reverse pass). `maxIterations` bounds the reverse-pass loop.
 */
export interface TextGradOptimizerOptions {
  llm: LLMPort;
  maxIterations: number;
}

/**
 * Extended `OptContext` carrying the `TextLoss` that drives the reverse
 * pass. `generate` requires this loss; plain `OptContext` callers (router)
 * are not supported by this optimiser.
 */
export type TextGradContext = OptContext & { loss: TextLoss };

// ---------------------------------------------------------------------------
// TextGradOptimizer.
// ---------------------------------------------------------------------------

export class TextGradOptimizer implements Optimizer {
  private readonly llm: LLMPort;
  private readonly maxIterations: number;

  constructor(opts: TextGradOptimizerOptions) {
    this.llm = opts.llm;
    this.maxIterations = opts.maxIterations;
  }

  // -------------------------------------------------------------------------
  // generate — orchestrate the TextGrad reverse pass for one substrate.
  // -------------------------------------------------------------------------

  /**
   * Produce `Mutant[]` for a prompt/skill substrate via:
   *   parse variables → backprop (per-variable gradients) → applyGradients
   *   (per-variable patch) → single candidate `Mutant`.
   *
   * Behaviour:
   *  - `weight` substrate → `NotImplementedError` (prompt/skill only).
   *  - any trajectory with `luckyPass === true` → `LuckyPassTrajectoryRejected`
   *    (defence-in-depth; checked BEFORE the reverse pass so a blind-retry
   *    trajectory never feeds the gradient computation).
   *  - prompt/skill substrate → exactly one `Mutant` (`origin='reflective'`,
   *    `parentSha=substrate.sha`) whose content reflects per-variable patches.
   */
  async generate(
    substrate: Substrate,
    ctx: OptContext,
  ): Promise<Mutant[]> {
    // weight channel is a V2 placeholder (L3-T15).
    if (substrate.kind === "weight") {
      throw new NotImplementedError(
        `L3-T12: TextGradOptimizer only supports prompt/skill substrates (got kind='${substrate.kind}'); weight channel is a V2 placeholder`,
      );
    }

    // The TextGrad reverse pass requires a `TextLoss` on the context. The
    // param is typed as `OptContext` to satisfy `implements Optimizer`; the
    // loss is read via the structured `TextGradContext` view.
    const loss = (ctx as TextGradContext).loss;
    if (loss === undefined) {
      throw new NotImplementedError(
        "L3-T12: TextGradOptimizer.generate requires ctx.loss (TextLoss) — plain OptContext is unsupported",
      );
    }

    // Defence-in-depth luckyPass guard (CE-T03 filters upstream; this
    // catches leakage — inherited L3-T03 contract).
    const trajectories: Trajectory[] = ctx.trajectories ?? [];
    for (const t of trajectories) {
      if (t.luckyPass === true) {
        throw new LuckyPassTrajectoryRejected(
          `L3-T12: trajectory ${t.id} carries luckyPass=true — blind-retry trajectories must not feed TextGrad reverse pass`,
        );
      }
    }

    const vars = parseVariables(substrate.content);
    const grads = this.backprop(loss, vars);
    const mutant = this.applyGradients(vars, grads);
    // Stamp the real parent sha now that we know the substrate.
    return [
      {
        ...mutant,
        parentSha: substrate.sha,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // backprop — per-variable text gradient computation (SYNC).
  // -------------------------------------------------------------------------

  /**
   * Compute an independent text gradient (`TextGrad`) for each variable.
   *
   * Gradient source (V1 MVP, sync — no LLM round-trip):
   *  1. `TextLoss.perVar[varId]` when present — the real per-variable
   *     feedback channel (populated upstream by trajectory diagnosis / the
   *     V2 async LLM reverse pass).
   *  2. Otherwise, route the aggregate `loss.feedback` to the STEERING
   *     variables (instruction / description) — these are the segments an
   *     aggregate failure diagnosis can legitimately steer. Few-shot DEMO
   *     variables get an empty gradient: demos must only be mutated by an
   *     explicit per-variable diagnosis (via `perVar`), never by aggregate
   *     feedback, which preserves per-variable isolation and prevents
   *     demo drift from an unrelated failure.
   *
   * Synchronous because the gradient is routed from the loss surface, not
   * awaited from the LLM. The `llm` is reserved for the V2 async reverse
   * pass. Returns one `TextGrad` per input variable, in order.
   */
  backprop(loss: TextLoss, vars: TextGradVariable[]): TextGrad[] {
    const perVar = loss.perVar;
    return vars.map((v) => {
      // (1) Explicit per-variable feedback wins.
      if (perVar !== undefined) {
        const explicit = perVar[v.id];
        if (explicit !== undefined) {
          return { varId: v.id, suggestion: explicit };
        }
      }
      // (2) Feedback-routing fallback: steering vars inherit aggregate
      //     feedback; demos stay untouched (per-variable isolation).
      if (v.role === "demo") {
        return { varId: v.id, suggestion: "" };
      }
      return { varId: v.id, suggestion: loss.feedback };
    });
  }

  // -------------------------------------------------------------------------
  // applyGradients — per-variable patch (SYNC, isolated).
  // -------------------------------------------------------------------------

  /**
   * Apply per-variable gradients to produce a single `Mutant`.
   *
   * For each variable: if its gradient `suggestion` is a non-empty string,
   * the variable's content is rewritten to the suggestion (the improvement
   * becomes the new segment text). If the suggestion is empty (no gradient),
   * the variable's content is preserved UNCHANGED — this is the per-variable
   * isolation invariant: a variable with no gradient is never mutated, and a
   * gradient on variable A only ever rewrites variable A.
   *
   * Returns a `Mutant` with `origin='reflective'` and a placeholder
   * `parentSha=''`; `generate` re-stamps the real `parentSha` once the
   * substrate is known.
   */
  applyGradients(vars: TextGradVariable[], grads: TextGrad[]): Mutant {
    const suggestionById = new Map<string, string>();
    for (const g of grads) {
      suggestionById.set(g.varId, g.suggestion);
    }
    const patched: TextGradVariable[] = vars.map((v) => {
      const suggestion = suggestionById.get(v.id) ?? "";
      if (typeof suggestion === "string" && suggestion.length > 0) {
        return { ...v, content: suggestion };
      }
      // No gradient for this variable → leave its content untouched.
      return v;
    });
    return {
      id: "textgrad-0",
      parentSha: "",
      content: assembleContent(patched),
      origin: "reflective",
    };
  }

  // Expose configured bounds for caller-side loop control (V2 async pass).

  get configuredMaxIterations(): number {
    return this.maxIterations;
  }

  get configuredLLM(): LLMPort {
    return this.llm;
  }
}
