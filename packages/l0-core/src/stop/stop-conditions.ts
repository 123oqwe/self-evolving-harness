// L0C-T03 · Stop-condition layered skeleton + max_turns_handler synthesis.
//
// Spec: execution/L0-core/TASKS.md §L0C-T03 (ERRATA-amended).
//
// Four-layer stop detection with a locked priority order:
//   end_turn → abort → unrecoverable_error → max_turns
// (end_turn is an explicit stop signal and takes priority over the
// max_turns hard ceiling; abort is user intent and must precede the
// max_turns fallback; unrecoverable_error precedes max_turns too.)
//
// `evaluateStop` returning `{stop:false,...}` carries a non-empty continue
// `reason`; the `layer` field is informational in that case (defaults to
// "end_turn") — the StopLayer union intentionally has no "continue" member.
//
// `applyMaxTurnsHandler` validates a raw handler output against a strict
// schema; on any validation failure it falls back to a default handler that
// preserves the raw progress as `summary` and marks the run `incomplete:true`
// with empty `nextSteps` — never hard-fail (OpenAI Agents SDK
// max_turns_handler semantics).
//
/// <reference lib="dom" />
// NOTE on typebox: TASKS.md §L0C-T03 spec signature prescribes
// `@sinclair/typebox` for `MAX_TURNS_HANDLER_OUTPUT_SCHEMA`. typebox is not
// present in the locked dependency set and the implementer rules forbid
// adding new deps. The schema is therefore exported as a plain readonly
// descriptor object and validation is performed manually with equivalent
// strict semantics (additionalProperties:false == reject extra keys). This
// deviation is recorded in the task appeal; the runtime contract the tests
// assert is unchanged.

import type { StopReason } from "../transcript/types.js";

/** The four stop layers (no "continue" member — see file header). */
export type StopLayer = "end_turn" | "max_turns" | "unrecoverable_error" | "abort";

/** A stop decision returned by {@link evaluateStop}. */
export interface StopDecision {
  readonly stop: boolean;
  readonly layer: StopLayer;
  readonly reason: string;
}

/** Inputs to {@link evaluateStop}. */
export interface StopContext {
  stopReason: StopReason;
  turnIndex: number;
  maxTurns: number;
  abortSignal: AbortSignal;
  retryExhausted: boolean;
}

/** Result of a synthesized max_turns_handler run. */
export interface MaxTurnsHandlerResult {
  summary: string;
  incomplete: boolean;
  nextSteps: string[];
}

/** Default ceiling when no `maxTurns` is configured (L1 config overrides). */
export const DEFAULT_MAX_TURNS = 25;

/**
 * Priority order driving {@link evaluateStop}. Locked by spec GREEN:
 * end_turn → abort → unrecoverable_error → max_turns.
 */
const STOP_LAYER_PRIORITY: readonly StopLayer[] = [
  "end_turn",
  "abort",
  "unrecoverable_error",
  "max_turns",
];

/**
 * Strict schema descriptor for a max_turns_handler output.
 *
 * `{ summary: string, incomplete: boolean, nextSteps: string[] }` with no
 * additional properties. Exported as a plain readonly object (typebox was
 * unavailable under the no-new-deps rule — see file header).
 */
export const MAX_TURNS_HANDLER_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    summary: Object.freeze({ type: "string" }),
    incomplete: Object.freeze({ type: "boolean" }),
    nextSteps: Object.freeze({ type: "array", items: { type: "string" } }),
  }),
  required: Object.freeze(["summary", "incomplete", "nextSteps"]),
} as const);

/**
 * Evaluate the four-layer stop decision.
 *
 * Priority: end_turn → abort → unrecoverable_error → max_turns.
 * When nothing fires, returns a continue decision `{stop:false}` whose
 * `layer` is informational (`"end_turn"`) and `reason` is non-empty.
 */
export function evaluateStop(ctx: StopContext): StopDecision {
  // Drive the decision through the priority array so the order is
  // single-sourced in STOP_LAYER_PRIORITY.
  for (const layer of STOP_LAYER_PRIORITY) {
    const fired = fires(layer, ctx);
    if (fired) {
      return { stop: true, layer, reason: reasonFor(layer, ctx) };
    }
  }
  // Continue: tool_use within budget, not aborted, retry not exhausted.
  return {
    stop: false,
    layer: "end_turn",
    reason: `turn ${ctx.turnIndex} < max ${ctx.maxTurns}; continuing (stopReason=${ctx.stopReason})`,
  };
}

function fires(layer: StopLayer, ctx: StopContext): boolean {
  switch (layer) {
    case "end_turn":
      return ctx.stopReason === "end_turn";
    case "abort":
      return ctx.abortSignal.aborted === true;
    case "unrecoverable_error":
      // Unrecoverable API error: retry budget exhausted on a non-retryable
      // error stop reason. (retryExhausted gates it so a single transient
      // error does not immediately stop the loop.)
      return ctx.retryExhausted && ctx.stopReason === "error";
    case "max_turns":
      return ctx.turnIndex >= ctx.maxTurns;
  }
}

function reasonFor(layer: StopLayer, ctx: StopContext): string {
  switch (layer) {
    case "end_turn":
      return `end_turn signal at turn ${ctx.turnIndex}`;
    case "abort":
      return `abort signal at turn ${ctx.turnIndex}`;
    case "unrecoverable_error":
      return `retry exhausted on non-retryable error at turn ${ctx.turnIndex}`;
    case "max_turns":
      return `turn ${ctx.turnIndex} reached/exceeded max_turns ${ctx.maxTurns}`;
  }
}

/**
 * Validate `raw` against {@link MAX_TURNS_HANDLER_OUTPUT_SCHEMA}. On failure,
 * fall back to a default handler result that preserves the raw progress as
 * `summary` and flags the run incomplete — never throws.
 */
export function applyMaxTurnsHandler(raw: unknown): MaxTurnsHandlerResult {
  if (isValidHandlerOutput(raw)) {
    const value = raw as {
      summary: string;
      incomplete: boolean;
      nextSteps: string[];
    };
    return {
      summary: value.summary,
      incomplete: value.incomplete,
      nextSteps: [...value.nextSteps],
    };
  }
  // Fallback default handler: carry raw progress (non-empty summary),
  // mark incomplete, no next steps — never hard-fail.
  return {
    summary: summarizeRaw(raw),
    incomplete: true,
    nextSteps: [],
  };
}

function isValidHandlerOutput(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  // additionalProperties:false — reject unexpected keys.
  const known = new Set(["summary", "incomplete", "nextSteps"]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) return false;
  }
  if (typeof obj["summary"] !== "string") return false;
  if (typeof obj["incomplete"] !== "boolean") return false;
  const ns = obj["nextSteps"];
  if (!Array.isArray(ns)) return false;
  for (const item of ns) {
    if (typeof item !== "string") return false;
  }
  return true;
}

/** Produce a non-empty summary string from any raw input (fallback). */
function summarizeRaw(raw: unknown): string {
  if (raw === null || raw === undefined) return "max_turns reached; no handler output";
  if (typeof raw === "string") return raw.length > 0 ? raw : "max_turns reached; empty handler output";
  try {
    const json = JSON.stringify(raw);
    return json.length > 0 ? json : "max_turns reached; empty handler output";
  } catch {
    return "max_turns reached; unserializable handler output";
  }
}
