// L0C-T04 · Overflow recovery guard — single-shot lock + AbortController dispose.
//
// Spec: execution/L0-core/TASKS.md §L0C-T04 (ERRATA-amended signatures).
//
// Invariants (PRD §6.6 / pi agent-session.js L97, L1456, L1604, L1857-1892):
//  - `_overflowRecoveryAttempted` is a single-shot lock: within one turn at
//    most one compaction-recovery attempt is permitted. A second `length`
//    overflow while the lock is held must NOT trigger another compaction
//    (otherwise the harness enters an infinite compaction loop). The
//    fallback in that case is drop-oldest-tool_results.
//  - `reset(stopReason)` only clears the lock when `stopReason` is neither
//    `"error"` nor `"length"`. Resetting on every turn_end would defeat the
//    lock when an overflow is still in progress. (pi comment: "only reset on
//    non-error / non-length stop".)
//  - `dispose()` must abort the injected AbortController *even if the
//    `onDispose` hook throws* — implemented with `try { await hook() } finally
//    { abort() }` so a throwing hook cannot skip the teardown (no leak).
//
// ERRATA裁决: OverflowGuard constructor accepts an injectable
// `{ abortController?, onDispose? }`. `dispose()` is parameter-less; the hook
// is injected via the constructor. The controller is optional (spec GREEN
// hint uses `this.#abortController?.abort()`), so a guard constructed without
// a controller simply skips the abort.

import type { StopReason } from "../transcript/types.js";

/** Constructor options for {@link OverflowGuard}. */
export interface OverflowGuardOptions {
  /** Injected AbortController; aborted on `dispose()`. Optional. */
  readonly abortController?: AbortController;
  /** Optional async teardown hook run before abort in `dispose()`. */
  readonly onDispose?: () => Promise<void>;
}

/**
 * Single-shot overflow-recovery lock with guaranteed AbortController teardown.
 *
 * The lock encodes "at most one compaction-recovery attempt per turn"; a
 * second `length` overflow reuses the fallback path instead of looping.
 */
export class OverflowGuard {
  /** True once a compaction-recovery attempt has begun this turn. */
  #attempted = false;
  /** Injected controller (optional); aborted in `dispose()`. */
  readonly #abortController: AbortController | undefined;
  /** Injected async teardown hook (may throw; aborted regardless). */
  readonly #onDispose: (() => Promise<void>) | undefined;

  constructor(opts?: OverflowGuardOptions) {
    this.#abortController = opts?.abortController;
    this.#onDispose = opts?.onDispose;
  }

  /** Whether a compaction-recovery attempt has already begun this turn. */
  get attempted(): boolean {
    return this.#attempted;
  }

  /**
   * Attempt to begin a compaction-recovery. Returns `true` the first time
   * (and latches `attempted=true`); returns `false` on every subsequent call
   * until the lock is reset — the single-shot invariant that prevents an
   * infinite compaction loop on repeated `length` overflow.
   */
  beginCompaction(): boolean {
    if (this.#attempted) {
      return false;
    }
    this.#attempted = true;
    return true;
  }

  /**
   * Reset the single-shot lock — but ONLY when `stopReason` is neither
   * `"error"` nor `"length"`. Resetting on an error/length stop would clear
   * the lock while overflow recovery is still in progress, re-opening the
   * infinite-compaction-loop door. (pi: "only reset on non-error/non-length
   * stop".) The guard enforces this condition internally regardless of caller.
   */
  reset(stopReason: StopReason): void {
    if (stopReason === "error" || stopReason === "length") {
      return;
    }
    this.#attempted = false;
  }

  /**
   * Tear down the guard. Runs the injected `onDispose` hook (if any), then
   * aborts the AbortController in a `finally` block so a throwing hook cannot
   * skip the abort — the no-leak invariant.
   */
  async dispose(): Promise<void> {
    try {
      await this.#onDispose?.();
    } finally {
      this.#abortController?.abort();
    }
  }
}
