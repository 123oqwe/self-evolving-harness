// L0C-T04 · Retryable-error classifier + reset-on-success retry counter.
//
// Spec: execution/L0-core/TASKS.md §L0C-T04 (ERRATA-amended signatures).
//
// Invariants (PRD §6.6 / pi agent-session.js L99-104, L405-441, L793-803):
//  - 429 / 503 / 408 are retryable; everything else (e.g. 400 invalid_request,
//    500 internal_server_error) is not — a non-retryable error routes straight
//    to the `unrecoverable_error` stop layer.
//  - `RetryCounter.attempt` resets to 0 on success (reset-on-success). This is
//    a crash-recovery invariant: if it did not reset, a transient blip would
//    permanently inflate the counter and exhaust retries prematurely.
//
// `isRetryableError` is the public entry point (WBS §2 contract table). The
// `RetryClassifier` interface mentioned in the spec is an internal
// implementation detail and is NOT exported.
//
// ERRATA裁决: ApiError = { statusCode: number; message?: string }.
// (`name?` retained as an optional field for forwards-compat with provider
//  error subclasses; tests construct via `{ statusCode, message }` only.)

import type { StopReason } from "../transcript/types.js";

/**
 * A minimal API error shape consumed by the retry classifier.
 *
 * ERRATA裁决签名: `{ statusCode: number; message?: string }`. The optional
 * `name` field is kept for provider-error-subclass compatibility but is not
 * used by classification logic.
 */
export interface ApiError {
  readonly statusCode: number;
  readonly message?: string;
  readonly name?: string;
}

/**
 * HTTP status codes that are retryable.
 *  - 429 Too Many Requests (rate limit)
 *  - 503 Service Unavailable (overloaded)
 *  - 408 Request Timeout
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 503, 408]);

/**
 * Classify whether an API error is retryable.
 *
 * Public entry point per WBS §2 contract table (the spec's `RetryClassifier`
 * interface is internal-only and not exported).
 */
export function isRetryableError(err: ApiError): boolean {
  return RETRYABLE_STATUS.has(err.statusCode);
}

/**
 * Reset-on-success retry counter.
 *
 * `attempt` counts consecutive retryable errors since the last success. A
 * successful turn calls `onSuccess()` which resets the counter to 0 — this is
 * the crash-recovery invariant (reset-on-success 不可改): without it a single
 * transient 429 would permanently consume a retry slot.
 */
export class RetryCounter {
  #attempt = 0;

  /** Current consecutive-retryable-error count (0 after a success). */
  get attempt(): number {
    return this.#attempt;
  }

  /** Record a retryable error; increments the counter by 1. */
  onRetryableError(): void {
    this.#attempt += 1;
  }

  /** Record a success; resets the counter to 0 (reset-on-success invariant). */
  onSuccess(): void {
    this.#attempt = 0;
  }
}

// Re-export StopReason here so consumers of the retry module can import the
// reset-condition type from a single barrel without reaching into transcript
// types directly. (Barrel re-export; no logic.)
export type { StopReason };
