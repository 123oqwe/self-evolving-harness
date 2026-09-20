// L3-T06b: FunSearch island reseed (周期杀 worst-half) + MAP-Elites behavior
// bin 各留最优 [MVP].
//
// Spec: execution/L3-engine/TASKS.md §L3-T06b.
//
// Invariants:
//   - keep-all / never-auto-delete: reseed 的"杀"不是 delete，是把
//     `status` 置为 'retired' 并移出 island active 池；`size()` 不减。
//   - reseeded 候选是新 clone（new sha），由调用方后续评估后再 `insert`，
//     故 reseeded 不计入本 archive 的 size（避免 size 误增）。
//   - MAP-Elites 每 bin 留最优：更优者（严格支配旧者）替换旧者，旧者
//     status='retired' 且入 retired 池（非 delete）；劣者或非支配者不替换。
//
// Direction pins (mirror T05/T06a — 不动前序文件):
//   - resolve_rate: higher = better.
//   - cache_hit:    higher = better.
//   - token:        lower = better (FLIPPED).

import type { ArchiveEntry, Fitness } from "../types.js";
import { mulberry32, hashStr } from "../prng.js";

// ---------------------------------------------------------------------------
// Direction metadata (mirrors T05/T06a; kept inline to avoid touching
// prior-task files).
// ---------------------------------------------------------------------------

const COMPARED_DIMS: (keyof Fitness)[] = [
  "resolve_rate",
  "token",
  "cache_hit",
];

const HIGHER_BETTER: ReadonlySet<keyof Fitness> = new Set<keyof Fitness>([
  "resolve_rate",
  "cache_hit",
]);

/** Direction-adjusted value: "bigger = better" regardless of native direction. */
function adjustedValue(dim: keyof Fitness, v: number): number {
  return HIGHER_BETTER.has(dim) ? v : -v;
}

/**
 * Does fitness `a` strictly dominate fitness `b`?
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
      return false;
    }
    if (av > bv) {
      strictlyBetterInOne = true;
    }
  }
  return strictlyBetterInOne;
}

/**
 * Scalar tiebreak key (lower = worse) used only for deterministic total
 * ordering when Pareto domination counts tie. This is NOT a weighted-sum
 * selection objective (PRD §6.7 forbids weighted-sum for *selection*); it is
 * an internal archive-pruning tiebreak. Lower = worse → killed first.
 */
function tiebreakKey(f: Fitness): number {
  let k = 0;
  for (const dim of COMPARED_DIMS) {
    k += adjustedValue(dim, f[dim] as number);
  }
  return k;
}

// ===========================================================================
// IslandArchive — FunSearch periodic reseed.
// ===========================================================================

export interface IslandArchiveOptions {
  islandCount: number;
  reseedPeriod: number;
  prngSeed: number;
}

export interface ReseedResult {
  killed: ArchiveEntry[];
  reseeded: ArchiveEntry[];
}

/**
 * FunSearch island-model archive. Entries are hashed to an island by sha.
 * Periodically `reseed()` kills the worst-half of each island's active pool
 * (status → 'retired', kept in the keep-all store) and returns new clones of
 * each island's best survivor as reseed candidates (NOT inserted into the
 * store — the caller evaluates & re-inserts them).
 */
export class IslandArchive {
  private readonly islandCount: number;
  private readonly reseedPeriod: number;
  private readonly prngSeed: number;
  // keep-all store: active + retired, never shrinks.
  private readonly store = new Map<string, ArchiveEntry>();

  constructor(opts: IslandArchiveOptions) {
    this.islandCount = opts.islandCount;
    this.reseedPeriod = opts.reseedPeriod;
    this.prngSeed = opts.prngSeed;
  }

  /** Assign entry to an island by stable sha hash. */
  private islandOf(e: ArchiveEntry): number {
    return hashStr(e.sha) % this.islandCount;
  }

  /** Archive an entry (keep-all; duplicates overwrite by sha, which callers
   *  should avoid — the keep-all invariant is sha-keyed). */
  insert(e: ArchiveEntry): void {
    this.store.set(e.sha, e);
  }

  /** Number of archived entries (active + retired). Never decreases. */
  size(): number {
    return this.store.size;
  }

  /**
   * Periodic reseed. When `generation` is a positive multiple of
   * `reseedPeriod`, each island's active pool is sorted worst-first by Pareto
   * domination count (+ tiebreak); the worst half is retired (kept in store)
   * and one clone of each island's best survivor is returned as a reseed
   * candidate. Before the period → no-op.
   */
  reseed(generation: number): ReseedResult {
    if (this.reseedPeriod <= 0 || generation <= 0) {
      return { killed: [], reseeded: [] };
    }
    if (generation % this.reseedPeriod !== 0) {
      return { killed: [], reseeded: [] };
    }

    // Group active entries by island.
    const byIsland: ArchiveEntry[][] = [];
    for (let i = 0; i < this.islandCount; i++) {
      byIsland.push([]);
    }
    for (const e of this.store.values()) {
      if (e.status === "active") {
        byIsland[this.islandOf(e)]!.push(e);
      }
    }

    const killed: ArchiveEntry[] = [];
    const reseeded: ArchiveEntry[] = [];
    const prng = mulberry32(
      hashStr(`island-reseed:${this.prngSeed}:${generation}`),
    );

    for (let isl = 0; isl < this.islandCount; isl++) {
      const pool = byIsland[isl]!;
      if (pool.length === 0) {
        continue;
      }

      // Domination count (number of pool peers that dominate this entry).
      const counted = pool.map((e) => {
        let dom = 0;
        for (const other of pool) {
          if (other === e) {
            continue;
          }
          if (dominates(other.fitness, e.fitness)) {
            dom++;
          }
        }
        return { e, dom, tie: tiebreakKey(e.fitness) };
      });

      // Worst-first: higher domination count, then lower tiebreak key.
      counted.sort((a, b) => {
        if (a.dom !== b.dom) {
          return b.dom - a.dom;
        }
        return a.tie - b.tie;
      });

      const half = Math.floor(pool.length / 2);
      const survivors = counted.slice(half); // best half (low dom count)
      const worst = counted.slice(0, half); // worst half

      for (const { e } of worst) {
        e.status = "retired";
        killed.push(e);
      }

      // Reseed from best survivor: clone once per island.
      const best = survivors[0];
      if (best != null) {
        const cloneSha = `reseed:${generation}:${isl}:${prng()
          .toString(36)
          .slice(2, 10)}`;
        reseeded.push({
          sha: cloneSha,
          parentSha: best.e.sha,
          mutant: {
            id: `${best.e.mutant.id}-r${generation}`,
            parentSha: best.e.sha,
            content: best.e.mutant.content,
            origin: "archive",
          },
          fitness: { ...best.e.fitness },
          generation,
          status: "active",
        });
      }
    }

    return { killed, reseeded };
  }
}

// ===========================================================================
// MapElitesArchive — behavior bins, each keeps the best.
// ===========================================================================

export interface MapElitesOptions {
  behaviorDims: ((e: ArchiveEntry) => number)[];
  binCount: number;
}

/**
 * MAP-Elites behavior-bin archive. Each bin keeps the single best entry
 * (strictly-dominating newcomer evicts the incumbent). Evicted incumbents
 * move to a retired pool (never-auto-delete) and are returned to the caller
 * for bookkeeping; they are excluded from `bins()` (which returns current
 * occupants only).
 */
export class MapElitesArchive {
  private readonly behaviorDims: ((e: ArchiveEntry) => number)[];
  private readonly binCount: number;
  private readonly binsMap = new Map<string, ArchiveEntry>();
  private readonly retiredPool: ArchiveEntry[] = [];

  constructor(opts: MapElitesOptions) {
    this.behaviorDims = opts.behaviorDims;
    this.binCount = opts.binCount;
  }

  /** Compute the behavior-bin key for an entry. */
  private binKey(e: ArchiveEntry): string {
    const parts: string[] = [];
    for (const d of this.behaviorDims) {
      let v = d(e);
      // Clamp to a valid [0, binCount-1] index.
      let idx = Math.floor(v * this.binCount);
      if (!Number.isFinite(idx)) {
        idx = 0;
      }
      idx = Math.min(this.binCount - 1, Math.max(0, idx));
      parts.push(String(idx));
    }
    return parts.join(",");
  }

  /**
   * Insert into a behavior bin. If the bin is empty, the entry becomes the
   * occupant (returns null). If occupied, the newcomer evicts the incumbent
   * iff it strictly dominates the incumbent; the incumbent is retired
   * (status='retired', moved to the retired pool) and returned. A weaker or
   * non-dominating newcomer does NOT replace the incumbent (returns null).
   */
  insert(e: ArchiveEntry): ArchiveEntry | null {
    const key = this.binKey(e);
    const incumbent = this.binsMap.get(key);
    if (incumbent == null) {
      this.binsMap.set(key, e);
      return null;
    }
    if (dominates(e.fitness, incumbent.fitness)) {
      // Evict incumbent: retire (never delete) and replace.
      incumbent.status = "retired";
      this.retiredPool.push(incumbent);
      this.binsMap.set(key, e);
      return incumbent;
    }
    // Newcomer is weaker or non-dominating → no replacement.
    return null;
  }

  /** Current best occupant of each behavior bin. */
  bins(): ArchiveEntry[] {
    return Array.from(this.binsMap.values());
  }
}
