// L3-T06a: DGM open-ended tree archive（interesting=非严格劣即入档；keep-all variant） [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T06a.
//
// Invariants:
//   - keep-all / never-auto-delete: once an entry is archived it is never
//     removed. `retire()` flips `status` to 'retired' but keeps the entry
//     (rollback still returns it; `size()` is unchanged).
//   - interesting judgment: a child is "interesting" (eligible for archive)
//     iff it is NOT strictly dominated by its parent — i.e. it is non-strictly
//     worse (≥ parent in at least one objective, direction-adjusted). This
//     reuses the T05 Pareto dominance definition (mirrored locally so we do
//     not touch the already-landed T05 file, per the
//     "同包前序任务文件不删改" rule).
//   - duplicate sha → DuplicateArchiveEntry.
//
// Direction pins (must stay aligned with T04 strict-improvement & T05 Pareto):
//   - resolve_rate: higher = better.
//   - cache_hit:    higher = better.
//   - token:        lower = better (FLIPPED).

import type { ArchiveEntry, Fitness, ParetoPoint } from "../types.js";
import { ParetoSelector } from "../pareto-selector.js";

/**
 * Thrown when `insert()` is called with a sha already present in the archive.
 * Keep-all does not mean duplicate-all: each variant is uniquely identified by
 * its content sha.
 */
export class DuplicateArchiveEntry extends Error {
  constructor(sha: string) {
    super(`duplicate archive entry: ${sha}`);
    this.name = "DuplicateArchiveEntry";
  }
}

/**
 * Thrown when `rollback()` / `retire()` are called with an unknown sha.
 */
export class ArchiveEntryNotFound extends Error {
  constructor(sha: string) {
    super(`archive entry not found: ${sha}`);
    this.name = "ArchiveEntryNotFound";
  }
}

// ---------------------------------------------------------------------------
// Direction metadata (mirrors T05 pareto-selector; kept inline to avoid
// touching the prior-task T05 file).
// ---------------------------------------------------------------------------

const COMPARED_DIMS: (keyof Fitness)[] = [
  "resolve_rate",
  "token",
  "cache_hit",
];

// Dimensions where "higher = better" (no direction flip). token is flipped
// (lower = better).
const HIGHER_BETTER: ReadonlySet<keyof Fitness> = new Set<keyof Fitness>([
  "resolve_rate",
  "cache_hit",
]);

/** Direction-adjusted value: "bigger = better" regardless of native direction. */
function adjustedValue(dim: keyof Fitness, v: number): number {
  return HIGHER_BETTER.has(dim) ? v : -v;
}

/**
 * Does fitness `a` dominate fitness `b`?
 *
 * a dominates b iff a is >= b in every compared dim (direction-adjusted) AND
 * strictly > in at least one dim. Equal fitnesses do NOT dominate each other.
 * The `raw` field is never compared (diagnostic metadata, not an objective).
 */
function dominates(a: Fitness, b: Fitness): boolean {
  let strictlyBetterInOne = false;
  for (const dim of COMPARED_DIMS) {
    const av = adjustedValue(dim, a[dim] as number);
    const bv = adjustedValue(dim, b[dim] as number);
    if (av < bv) {
      // a is worse in this dim → cannot dominate b.
      return false;
    }
    if (av > bv) {
      strictlyBetterInOne = true;
    }
  }
  return strictlyBetterInOne;
}

/**
 * DGM open-ended tree archive. In-memory `Map<sha, ArchiveEntry>`.
 *
 * Persistence lands in T08 (git-versioned substrate); this MVP keeps the
 * map in memory and exposes a `persist(store)`-shaped seam via the public
 * methods (`rollback`/`size`/`retire`) so T08 can wire a git backend without
 * touching this file's surface.
 */
export class TreeArchive {
  private readonly entries = new Map<string, ArchiveEntry>();
  private readonly selector = new ParetoSelector();

  /**
   * Is `child` interesting relative to `parent`? Interesting = non-strictly
   * dominated by parent (child is ≥ parent in at least one objective,
   * direction-adjusted). Reuses T05 dominance: interesting = !dominates(parent, child).
   */
  isInteresting(child: Fitness, parent: Fitness): boolean {
    return !dominates(parent, child);
  }

  /**
   * Archive an entry. Interesting judgment:
   *   - root entry (parentSha == null) → always archived (no parent to judge).
   *   - parent not present in archive → archived (open-ended, cannot judge).
   *   - parent present and child strictly dominated by parent → NOT archived
   *     (rejected at insert; "严格劣 → 拒"). This is not a delete — the entry
   *     was never added.
   *   - otherwise (interesting) → archived.
   * Duplicate sha → throws DuplicateArchiveEntry (checked before the
   * interesting judgment so a duplicate strictly-dominated child still errors
   * rather than silently no-op'ing — keeps the invariant observable).
   */
  insert(e: ArchiveEntry): void {
    if (this.entries.has(e.sha)) {
      throw new DuplicateArchiveEntry(e.sha);
    }
    if (e.parentSha != null) {
      const parent = this.entries.get(e.parentSha);
      if (parent != null && !this.isInteresting(e.fitness, parent.fitness)) {
        // strictly dominated by parent → not interesting → reject at insert.
        return;
      }
    }
    this.entries.set(e.sha, e);
  }

  /**
   * Pareto non-dominated front over all archived entries (active + retired —
   * retired entries remain selectable for rollback/revert per keep-all).
   * Consistent with T05 `ParetoSelector.nonDominatedFront`.
   */
  queryNonDominated(): ArchiveEntry[] {
    const points: ParetoPoint[] = [];
    for (const e of this.entries.values()) {
      points.push({ mutant: e.mutant, fitness: e.fitness });
    }
    const front = this.selector.nonDominatedFront(points);
    // Map back to archive entries by identity of the mutant reference.
    const frontMutants = new Set(front.map((p) => p.mutant));
    const result: ArchiveEntry[] = [];
    for (const e of this.entries.values()) {
      if (frontMutants.has(e.mutant)) {
        result.push(e);
      }
    }
    return result;
  }

  /**
   * Return the archived variant for `sha` (keep-all: the entry is still
   * present even if retired). Throws ArchiveEntryNotFound if absent.
   */
  rollback(sha: string): ArchiveEntry {
    const e = this.entries.get(sha);
    if (e == null) {
      throw new ArchiveEntryNotFound(sha);
    }
    return e;
  }

  /** Number of archived entries (active + retired). Never decreases. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Retire an entry: flip `status` to 'retired' WITHOUT deleting it
   * (never-auto-delete invariant — `size()` is unchanged, `rollback()` still
   * returns the entry with status='retired'). Throws if absent.
   */
  retire(sha: string): void {
    const e = this.entries.get(sha);
    if (e == null) {
      throw new ArchiveEntryNotFound(sha);
    }
    e.status = "retired";
  }
}
