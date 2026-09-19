// L3-engine · FitnessBridge — telemetry flywheel → Fitness generalisation.
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 (FitnessBridge) + ERRATA-w2plus
// §L3-T09 (fitness generalisation detection heuristic).
//
// PRD §7.3 key point: the evolve-skill original "skill pass@k" metric must NOT
// leak into the L3 engine. The bridge maps a telemetry span to the generalised
// multi-objective Fitness triple {resolve_rate, token, cache_hit}; any span
// that smuggles the raw skill metric is rejected with FitnessGeneralizationError.
//
// Mapping contract (locked by tests/L3/T09-evolve-skill-adapter.spec.ts):
//   - resolve_rate ← gen_ai_evaluation.pass (true→1, false→0)
//   - token        ← usage.output
//   - cache_hit    ← cache_read / 100  (cache_read is a 0..100 percentage)
//
// Error paths:
//   - span missing `usage` (or usage.output) → IncompleteTelemetry (signal loss)
//   - span carrying `skillPassAtK` → FitnessGeneralizationError (raw metric leak;
//     ERRATA heuristic: skillPassAtK field present → reject rather than silently
//     using the un-generalised skill metric).

import type { Fitness } from "../types.js";

// ---------------------------------------------------------------------------
// Error classes (named exports so tests can assert `toThrow(...)`)
// ---------------------------------------------------------------------------

/**
 * Raised when a telemetry span is missing a required signal (e.g. `usage`)
 * and a generalised Fitness cannot be computed.
 */
export class IncompleteTelemetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteTelemetry";
  }
}

/**
 * Raised when a telemetry span carries the raw evolve-skill "skillPassAtK"
 * metric. PRD §7.3 forbids the un-generalised skill metric from leaking into
 * the L3 fitness; the bridge rejects the span instead of silently consuming
 * the raw metric.
 */
export class FitnessGeneralizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitnessGeneralizationError";
  }
}

// ---------------------------------------------------------------------------
// Telemetry span shape (loose; only the consumed keys are typed)
// ---------------------------------------------------------------------------

export interface TelemetrySpan {
  gen_ai_evaluation?: { pass?: boolean };
  usage?: { output?: number } | object;
  cache_read?: number;
  // Raw skill metrics are forbidden; their presence triggers the
  // generalisation guard. Modelled as an explicit optional so the bridge can
  // detect smuggled raw metrics via `"skillPassAtK" in span`.
  skillPassAtK?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// FitnessBridge — telemetry → Fitness
// ---------------------------------------------------------------------------

/**
 * Maps a telemetry span to a generalised {@link Fitness}.
 *
 * Behaviour (locked by T09 spec statements):
 *  - `{pass:true, usage:{output:100}, cache_read:80}` → `{resolve_rate:1, token:100, cache_hit:0.8}`.
 *  - missing `usage` → throws {@link IncompleteTelemetry}.
 *  - `pass:false` → `resolve_rate=0`.
 *  - span carrying `skillPassAtK` → throws {@link FitnessGeneralizationError}.
 */
export class FitnessBridge {
  fromTelemetry(span: TelemetrySpan): Fitness {
    // Generalisation guard (ERRATA heuristic): the raw evolve-skill pass@k
    // metric must not leak. Detect it BEFORE consuming the span so a span that
    // is otherwise valid but smuggles skillPassAtK is rejected.
    if ("skillPassAtK" in span) {
      throw new FitnessGeneralizationError(
        "fitness generalisation error: raw skill pass@k metric leaked (skillPassAtK present) — map to resolve_rate/token/cache_hit before scoring",
      );
    }

    // Required signal: usage.output → token.
    if (span.usage === undefined || span.usage === null) {
      throw new IncompleteTelemetry(
        "incomplete telemetry: span missing `usage` — cannot derive token",
      );
    }
    const usage = span.usage as { output?: number };
    if (usage.output === undefined || typeof usage.output !== "number") {
      throw new IncompleteTelemetry(
        "incomplete telemetry: span missing `usage.output` — cannot derive token",
      );
    }

    // resolve_rate ← gen_ai_evaluation.pass (boolean → 0/1). A missing marker
    // is treated as a failure (pass=false → resolve_rate=0): the telemetry
    // flywheel only reports a success when the evaluation marker says so.
    const pass = span.gen_ai_evaluation?.pass === true;
    const resolve_rate = pass ? 1 : 0;

    const token = usage.output;

    const cacheRead =
      typeof span.cache_read === "number" ? span.cache_read : 0;
    const cache_hit = cacheRead / 100;

    return { resolve_rate, token, cache_hit };
  }
}
