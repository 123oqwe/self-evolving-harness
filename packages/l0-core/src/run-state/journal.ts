// L0C-T07b · per-agent WRITE DELTA journal.
//
// Spec: execution/L0-core/TASKS.md §L0C-T07b (ERRATA-amended).
//
// Parallel agents write deltas concurrently; on join, the deltas must be
// replayed in **completion order** (not initiation order). This is the race
// fixed by pi-dynamic-workflows PR #48 (keyed `runId:callIndex`,
// research/01-inventory.md Module 12.2).
//
// ERRATA rulings (T07b) honored here:
//  - `write` does NOT throw on a repeated key — it stores silently (last
//    write wins for the stored delta). Conflict detection is the job of
//    `assertNoConflict`, called at join time.
//  - `assertNoConflict` throws iff some key was written more than once.
//    The throw happens at `assertNoConflict` call time, not at `write`
//    time — so a journal can accumulate during a parallel run and only fail
//    the join if a true conflict materialized.

/**
 * Per-agent WRITE DELTA journal, keyed `${runId}:${callIndex}`.
 *
 * Concurrent `write` calls store deltas keyed by `(runId, callIndex)`. A
 * repeated write to the same key stores silently (last write wins for the
 * stored delta); the conflict is surfaced later by {@link assertNoConflict}
 * at join time.
 */
export class WriteDeltaJournal {
  /** key → latest delta (last write wins, stored silently). */
  private readonly entries: Map<string, unknown> = new Map();
  /** key → number of writes (for conflict detection). */
  private readonly writeCounts: Map<string, number> = new Map();

  /**
   * Write a delta for `(runId, callIndex)`.
   *
   * A repeated write to the same key does NOT throw here — it stores
   * silently (last write wins). Use {@link assertNoConflict} at join time
   * to surface any key written more than once.
   */
  write(runId: string, callIndex: number, delta: unknown): void {
    const key = journalKey(runId, callIndex);
    this.entries.set(key, delta);
    this.writeCounts.set(key, (this.writeCounts.get(key) ?? 0) + 1);
  }

  /**
   * Replay deltas in **completion order** (the order agents finished), not
   * initiation order.
   *
   * @throws Error if `completionOrder` contains a key that was never
   *         written.
   */
  replay(
    completionOrder: Array<{ runId: string; callIndex: number }>,
  ): unknown[] {
    const out: unknown[] = [];
    for (const { runId, callIndex } of completionOrder) {
      const key = journalKey(runId, callIndex);
      const delta = this.entries.get(key);
      if (delta === undefined && !this.entries.has(key)) {
        throw new Error(
          `WriteDeltaJournal.replay: no delta written for key ${key}`,
        );
      }
      out.push(delta);
    }
    return out;
  }

  /**
   * Surface any conflict: throw iff some key was written more than once.
   *
   * ERRATA: the throw happens here (at join time), not at `write` time.
   */
  assertNoConflict(): void {
    for (const [key, count] of this.writeCounts) {
      if (count > 1) {
        throw new Error(
          `WriteDeltaJournal.assertNoConflict: key ${key} written ${count} times (conflict)`,
        );
      }
    }
  }
}

/**
 * Canonical journal key: `${runId}:${callIndex}`.
 */
function journalKey(runId: string, callIndex: number): string {
  return `${runId}:${callIndex}`;
}
