// L3-T08: Voyager commit-on-success retain [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T08.
//
// Retain step: a variant that passes strict-improvement + Pareto select is
// committed to the git-versioned substrate with an auto-incremented version
// suffix (name → nameV2 → nameV3). The vector index keeps the unique newest
// version per base name (older versions remain in the archive but `latest`
// returns the newest). A variant that fails the gate is NOT committed
// (returns null) — no new active archive entry.
//
// Version-suffix contract (spec GREEN): regex `/(V(\d+))?$/`.
//   - "phase-init"      → "phase-initV2"   (first bump)
//   - "phase-initV2"    → "phase-initV3"   (existing suffix → next V)
//
// The git checkout rollback execution body is NOT here — it lives in CE-T06
// `src/revert.ts` (static-core, single ownership). L3-T08 only owns the
// `Retain` step + the `AutoRevert` shadow/revert-trigger hook (see
// auto-revert.ts). `git-client.ts` (REFACTOR step) is a thin command-builder
// helper reused by L1/L2 rollback paths; it does not run git itself.

import type { ArchiveEntry, Mutant } from "../types.js";
import { hashStr } from "../prng.js";

/**
 * Gate result passed to `Retain.commit`. Both flags must be true for the
 * variant to be retained (spec: strict-improvement hard gate AND Pareto
 * non-dominated front).
 */
export interface RetainGate {
  strictImprovement: boolean;
  paretoFront: boolean;
}

/**
 * Commit result. `version` is the bumped substrate name (e.g. "phase-initV2");
 * `sha` is the committed content sha (the git-versioned substrate identity).
 */
export interface CommitResult {
  version: string;
  sha: string;
}

/**
 * Version-suffix regex (spec GREEN: `/(V(\d+))?$/`).
 *
 * Matches an optional trailing `V<digits>` and captures the digits. Used by
 * both `bumpVersion` and the vector-index base-name extractor.
 */
const VERSION_SUFFIX = /(V(\d+))?$/;

/**
 * Extract the base name (trailing `V<digits>` stripped) from a substrate
 * name. Examples: "phase-initV2" → "phase-init"; "x" → "x".
 */
export function baseName(name: string): string {
  return name.replace(VERSION_SUFFIX, "");
}

/**
 * Auto-increment the version suffix of a substrate name.
 *
 *   - No suffix  → appends `V2`  (first bump, Voyager convention).
 *   - `V<n>`     → appends `V<n+1>`.
 *
 * The regex is anchored at the end so base names containing "V" elsewhere
 * (e.g. "Voyager-init") are unaffected.
 */
export function bumpVersion(currentName: string): string {
  const m = VERSION_SUFFIX.exec(currentName);
  const next = m && m[2] ? parseInt(m[2], 10) + 1 : 2;
  return `${baseName(currentName)}V${next}`;
}

/**
 * Vector index: holds the unique newest version per base name. Older
 * versions are NOT deleted (keep-all invariant) — they remain retrievable
 * via the archive; `latest` simply returns the highest-version entry.
 */
export interface VectorIndex {
  latest(name: string): ArchiveEntry | null;
}

/**
 * Voyager commit-on-verify retain.
 *
 * `commit` returns a `{version, sha}` result iff both gate flags are true;
 * otherwise `null` (no retain, no new active archive entry). On a successful
 * commit the mutant is recorded in the vector index under its base name,
 * superseding any prior entry for that base name as the new "latest".
 */
export class Retain {
  /** Base name → newest committed entry (the unique-latest slot). */
  private readonly _latestByBase = new Map<string, ArchiveEntry>();
  /** Every committed entry, in commit order (keep-all). */
  private readonly _entries: ArchiveEntry[] = [];
  private _generation = 0;

  public readonly vectorIndex: VectorIndex;

  constructor() {
    this.vectorIndex = {
      latest: (name: string): ArchiveEntry | null => {
        return this._latestByBase.get(baseName(name)) ?? null;
      },
    };
  }

  /** Instance-bound version bumper (spec interface: `bumpVersion(name)`). */
  bumpVersion(currentName: string): string {
    return bumpVersion(currentName);
  }

  /**
   * Commit a mutant iff it passed both gates. Returns the bumped version +
   * content sha, or `null` when the gate failed.
   */
  commit(
    mutant: Mutant,
    gate: RetainGate,
  ): CommitResult | null {
    if (!gate.strictImprovement || !gate.paretoFront) {
      return null;
    }
    const version = bumpVersion(mutant.content);
    const sha = `sha-${hashStr(mutant.content + version).toString(16)}`;
    const entry: ArchiveEntry = {
      sha,
      parentSha: mutant.parentSha,
      mutant,
      fitness: {
        resolve_rate: 0,
        token: 0,
        cache_hit: 0,
      },
      generation: this._generation++,
      status: "active",
    };
    this._entries.push(entry);
    this._latestByBase.set(baseName(mutant.content), entry);
    return { version, sha };
  }
}
