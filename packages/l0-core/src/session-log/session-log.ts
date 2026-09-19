// L0C-T07b · session log append-only contract + wake rehydration.
//
// Spec: execution/L0-core/TASKS.md §L0C-T07b (ERRATA-amended).
//
// The session log is the "source of truth outside the harness"
// (ARCHITECTURE.txt trust domain): an append-only event stream that a fresh
// harness can `wake(sessionId)` from after a crash, rebuilding state purely
// from the log — no dependence on harness in-memory state.
//
// ERRATA rulings (T07b) honored here:
//  - `getEvents(fromSeq)` → `fromSeq` is a 0-based index *within the session*
//    (not a global event index). Out-of-range → `[]`. Negative → throw.
//  - `wake(sessionLog, sessionId)` returns events in **append order** (same
//    order as `getEvents`), NOT sorted by `ts`. Sort key = append order.
//
// Invariants enforced:
//  - `append` is append-only: rewriting an existing uuid throws (state left
//    untouched — original event not overwritten).
//  - `has(uuid)` is an O(1) membership test.
//  - `getEvents(sessionId)` filters by session and preserves append order;
//    `parentUuid` branches are traceable because every event retains its
//    `parentUuid` pointer.
//
// Persistence format (JSONL) is deferred to TL-T01; this is an in-memory
// implementation of the contract.

/**
 * A single append-only session log event.
 *
 * `parentUuid === null` marks the root of a session; a fork/branch resumes
 * from a fork point by setting `parentUuid` to that point's uuid, forming a
 * conversational tree (CC JSONL transcript `parentUuid` convention).
 */
export interface SessionLogEvent {
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly type: string;
  readonly sessionId: string;
  readonly ts: number;
  readonly payload: unknown;
}

/**
 * Append-only session log (in-memory contract implementation).
 *
 * Events are stored in append order; per-session sequences are projected
 * from that global append order so `wake` rehydrates in the same order the
 * crashed harness emitted them.
 */
export class SessionLog {
  /** Global append-ordered event list. */
  private readonly events: SessionLogEvent[] = [];
  /** uuid → event, for O(1) `has` and append-only dedup. */
  private readonly byUuid: Map<string, SessionLogEvent> = new Map();
  /** sessionId → ordered indices into `events` (append order per session). */
  private readonly perSession: Map<string, number[]> = new Map();

  /**
   * Append an event. Append-only: an event whose `uuid` already exists is
   * rejected with a throw (the existing event is NOT overwritten — state
   * consistency is preserved).
   *
   * @throws Error if `event.uuid` already exists (append-only violation).
   */
  append(event: SessionLogEvent): void {
    if (this.byUuid.has(event.uuid)) {
      throw new Error(
        `SessionLog.append: uuid already exists (append-only violated): ${event.uuid}`,
      );
    }
    this.byUuid.set(event.uuid, event);
    const index = this.events.push(event) - 1;
    let seq = this.perSession.get(event.sessionId);
    if (seq === undefined) {
      seq = [];
      this.perSession.set(event.sessionId, seq);
    }
    seq.push(index);
  }

  /**
   * Project the events for `sessionId`, in append order, starting at the
   * session-local 0-based index `fromSeq`.
   *
   * ERRATA: `fromSeq` is a 0-based index *within the session* (the n-th
   * event of that session), not a global event index.
   *
   * - `fromSeq === undefined` → all events for the session.
   * - `fromSeq < 0` → throw.
   * - `fromSeq >= sessionEventCount` → `[]` (out of range).
   */
  getEvents(sessionId: string, fromSeq?: number): SessionLogEvent[] {
    const indices = this.perSession.get(sessionId);
    if (indices === undefined || indices.length === 0) {
      return [];
    }
    let start: number;
    if (fromSeq === undefined) {
      start = 0;
    } else {
      if (fromSeq < 0) {
        throw new Error(
          `SessionLog.getEvents: fromSeq must be >= 0, got ${fromSeq}`,
        );
      }
      start = fromSeq;
    }
    if (start >= indices.length) {
      return [];
    }
    const out: SessionLogEvent[] = [];
    for (let i = start; i < indices.length; i++) {
      const globalIndex = indices[i]!;
      out.push(this.events[globalIndex]!);
    }
    return out;
  }

  /**
   * O(1) membership test by uuid.
   */
  has(uuid: string): boolean {
    return this.byUuid.has(uuid);
  }
}

/**
 * Rehydrate a session's event stream after a crash.
 *
 * ERRATA: events are returned in **append order** (same as `getEvents`),
 * NOT sorted by `ts`. A fresh harness rebuilds state by replaying events in
 * the exact order the crashed harness emitted them.
 *
 * @returns `{ events }` — the session's event stream in append order.
 */
export function wake(
  sessionLog: SessionLog,
  sessionId: string,
): { events: SessionLogEvent[] } {
  return { events: sessionLog.getEvents(sessionId) };
}
