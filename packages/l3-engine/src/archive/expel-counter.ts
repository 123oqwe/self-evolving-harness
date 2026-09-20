// L3-T07: ExpeL upvote/downvote importance counter [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T07.
// Errata L3-04: constructor accepts optional `archive` param
//   `constructor({ initialCount, minEvidence, archive? })`.
//
// Invariants:
//   - importanceCount starts at `initialCount` (default per spec = 2, from the
//     ExpeL paper, PRD §7.3). Counts are lazily initialised on first access so
//     a freshly-referenced sha reads as `initialCount`.
//   - UPVOTE +1 / DOWNVOTE -1.
//   - count never underflows below 0 (capped at 0). A count of 0 means
//     `shouldRetire` is true.
//   - `retire(sha)` flips the archive entry's status to 'retired' WITHOUT
//     deleting it (never-auto-delete — size() unchanged, rollback() still
//     returns the entry). This unifies with T06a TreeArchive per the spec
//     REFACTOR note; when no archive is injected, retire tracks the retired
//     sha in an internal set so `shouldRetire` stays consistent.
//   - `< minEvidence` evidence → `shouldActivate` false. minEvidence=2 aligns
//     with L2-T04b "≥2 evidence" contract; do not change.
//
// The ExpelCounter is a pure counter that *attaches* to a T06a TreeArchive; it
// does not own the variant store. importanceCount is the single source of
// truth for activation/retirement decisions here.

import type { TreeArchive } from "./tree-archive.js";

/** Options for {@link ExpelCounter}. */
export interface ExpelCounterOptions {
  /** Initial importanceCount for a freshly-referenced sha (ExpeL default = 2). */
  initialCount: number;
  /** Minimum evidence count required to activate an insight (default = 2). */
  minEvidence: number;
  /**
   * Optional T06a TreeArchive. When present, `retire(sha)` delegates to
   * `archive.retire(sha)` so the keep-all / never-auto-delete invariant is
   * observed through the real archive backend. Per errata L3-04.
   */
  archive?: TreeArchive;
}

/**
 * ExpeL upvote/downvote importance counter.
 *
 * Each archive entry carries an `importanceCount` (start 2). UPVOTE +1,
 * DOWNVOTE -1; count==0 → retire (status='retired', NOT deleted).
 * `< minEvidence` evidence → insight not activated.
 */
export class ExpelCounter {
  private readonly initialCount: number;
  private readonly minEvidence: number;
  private readonly archive: TreeArchive | undefined;
  /** Lazy-init per-sha importance counts. */
  private readonly counts = new Map<string, number>();
  /** Retired shas (used only when no archive is injected). */
  private readonly retiredNoArchive = new Set<string>();

  constructor(opts: ExpelCounterOptions) {
    this.initialCount = opts.initialCount;
    this.minEvidence = opts.minEvidence;
    this.archive = opts.archive;
  }

  /** Current importanceCount for `sha`, lazily initialised to `initialCount`. */
  private getCount(sha: string): number {
    const c = this.counts.get(sha);
    if (c == null) {
      this.counts.set(sha, this.initialCount);
      return this.initialCount;
    }
    return c;
  }

  /** UPVOTE: +1. Returns the new count. */
  upvote(sha: string): number {
    const next = this.getCount(sha) + 1;
    this.counts.set(sha, next);
    return next;
  }

  /** DOWNVOTE: -1, capped at 0 (no underflow). Returns the new count. */
  downvote(sha: string): number {
    const next = Math.max(0, this.getCount(sha) - 1);
    this.counts.set(sha, next);
    return next;
  }

  /** count==0 → should retire (but NOT delete). */
  shouldRetire(sha: string): boolean {
    return this.getCount(sha) === 0;
  }

  /**
   * evidenceCount >= minEvidence → insight may activate.
   * `< minEvidence` (e.g. <2) → insufficient evidence → false.
   */
  shouldActivate(_sha: string, evidenceCount: number): boolean {
    return evidenceCount >= this.minEvidence;
  }

  /**
   * Retire `sha`: flip status to 'retired' WITHOUT deleting the entry
   * (never-auto-delete invariant). When an archive was injected, delegates to
   * `archive.retire(sha)` so `size()` is unchanged and `rollback()` still
   * returns the entry with status='retired'. Without an archive, tracks the
   * retired sha internally.
   */
  retire(sha: string): void {
    if (this.archive != null) {
      // Delegates to T06a TreeArchive.retire — which throws ArchiveEntryNotFound
      // for an unknown sha (defence-in-depth; keeps the invariant observable).
      this.archive.retire(sha);
    } else {
      this.retiredNoArchive.add(sha);
    }
  }
}
