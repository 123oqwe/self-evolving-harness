// L0C-T05 · compaction cut-point boundary contract.
//
// Spec: execution/L0-core/TASKS.md §L0C-T05 (ERRATA-amended signatures).
//
// Invariants (PRD §6.6 / pi compaction.js L260-340 + L264-267 comment:
// "Never cut at tool results, they must follow their tool call"):
//  - A compaction cut point must fall on a user/assistant message boundary.
//    Cutting at a `tool_result` would orphan it from its preceding
//    `tool_use` → provider 400 (Anthropic requires every tool_result to
//    follow its tool_use in the same turn batch).
//  - When we cut at an assistant message containing tool_use blocks, its
//    tool_result blocks follow it and are kept — so assistant(tool_use) IS
//    a valid cut point (do NOT mistake it for an invalid one).
//  - `compaction` entries are not message boundaries and are never cut points.
//  - The stable prefix region `[0, prefixLen)` is untouchable by any
//    compaction cut (`assertStablePrefixUntouched`).
//
// ERRATA裁决: canonical names are `CutPointEntry` (not `CompactionEntry`)
// and `findValidCutPoints` (plural, not singular `findCutPoint`).
// `DEFAULT_RESERVE` / `DEFAULT_KEEP_RECENT` are exported here as the L1
// config default anchors.

/**
 * A flattened transcript entry for cut-point selection. Only `user` and
 * `assistant` entries are legal cut boundaries; `tool_result` must stay
 * attached to its preceding `assistant(tool_use)`, and `compaction` is a
 * synthesized boundary marker, not a cut point.
 */
export type CutPointEntry = {
  type: "user" | "assistant" | "tool_result" | "compaction";
};

/** Default reserve-token budget kept above the cut (L1 config anchor). */
export const DEFAULT_RESERVE = 16384 as const;

/** Default keep-recent token window (L1 config anchor). */
export const DEFAULT_KEEP_RECENT = 20000 as const;

/**
 * Whether `entry` is a legal cut-point message (a real message boundary).
 * `user` and `assistant` are boundaries; `tool_result` and `compaction` are
 * not. Cutting at `assistant(tool_use)` is legal — its tool_results follow
 * and are kept (pi compaction.js L264-267).
 */
function isCutPointMessage(entry: CutPointEntry): boolean {
  return entry.type === "user" || entry.type === "assistant";
}

/**
 * Find valid cut points in `entries[start, end)`.
 *
 * Returns the indices of every `user`/`assistant` entry in the half-open
 * range. `compaction` and `tool_result` entries are skipped (never cut
 * points). Out-of-range `[start, end)` yields `[]`.
 *
 * Ported (simplified) from pi `findValidCutPoints` (compaction.js L260-275):
 * walk the slice, push index iff `isCutPointMessage`.
 */
export function findValidCutPoints(
  entries: CutPointEntry[],
  start: number,
  end: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = start; i < end; i++) {
    const entry = entries[i];
    if (entry === undefined) {
      continue;
    }
    if (entry.type === "compaction") {
      continue;
    }
    if (isCutPointMessage(entry)) {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/**
 * Assert that cutting at `cutIndex` does not orphan a `tool_result` or land on
 * a non-boundary entry.
 *
 * Throws iff `entries[cutIndex]` is a `tool_result` or `compaction` (cut at
 * `tool_result` → orphaned tool_result whose preceding assistant's tool_use
 * loses its pairing → provider 400; cut at `compaction` → not a message
 * boundary). The "preceding assistant contains an unpaired tool_use" branch
 * is an internal detail; the GWT contract locks only cut-at-tool_result /
 * cut-at-compaction throws.
 */
export function assertCutNotOrphan(
  entries: CutPointEntry[],
  cutIndex: number,
): void {
  const entry = entries[cutIndex];
  if (entry === undefined) {
    throw new Error(
      `assertCutNotOrphan: cutIndex ${cutIndex} out of range (entries length ${entries.length})`,
    );
  }
  if (entry.type === "tool_result" || entry.type === "compaction") {
    throw new Error(
      `assertCutNotOrphan: cut at ${entry.type} (index ${cutIndex}) would orphan it / is not a message boundary`,
    );
  }
}

/**
 * Assert a compaction cut point does not fall inside the stable prefix region.
 *
 * `cutIndex < prefixLen` → throw (the stable prefix is untouchable by
 * compaction; cutting it would invalidate the cache_control exact-prefix match
 * → 10x cost). `cutIndex >= prefixLen` → pass.
 */
export function assertStablePrefixUntouched(
  cutIndex: number,
  prefixLen: number,
): void {
  if (cutIndex < prefixLen) {
    throw new Error(
      `assertStablePrefixUntouched: cutIndex ${cutIndex} falls inside stable prefix region [0, ${prefixLen}) — stable prefix is untouchable by compaction`,
    );
  }
}
