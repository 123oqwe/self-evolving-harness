// L0C-T08 · pre-commit static-core guard.
//
// Spec: execution/L0-core/TASKS.md §L0C-T08 (ERRATA-amended).
//
// Detects five dangerous-diff kinds at pre-commit (static, line-level text
// matching — NOT YAML parsing):
//   (1) safety_segment_deleted        — a `<safety>` line is removed
//   (2) deny_to_allow                 — bash|write policy flips deny → allow
//   (3) static_core_field_removed      — a registered static-core field def
//                                        is deleted
//   (4) acceptance_threshold_widened  — an acceptance threshold moves in the
//                                        "looser" direction (only tighten OK)
//   (5) resource_control_model_realloc— resources control-model flips
//                                        false → true
//
// Diff hunks are plain line-level text: oldLines = removed lines,
// newLines = added lines. Detectors operate on the aggregated old/new lines
// across all hunks of a diff (substring / line-content matching).

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Diff {
  readonly path: string;
  readonly hunks: Array<{ oldLines: string[]; newLines: string[] }>;
}

export type DangerousDiffKind =
  | "safety_segment_deleted"
  | "deny_to_allow"
  | "static_core_field_removed"
  | "acceptance_threshold_widened"
  | "resource_control_model_realloc";

export interface PreCommitVerdict {
  readonly allow: boolean;
  readonly violations: DangerousDiffKind[];
  readonly reasons: string[];
}

// ---------------------------------------------------------------------------
// Registries (static-core themselves: removing a registry entry is itself a
// violation basis — they are frozen so runtime mutation throws in strict mode)
// ---------------------------------------------------------------------------

/**
 * Registered static-core field names. Deleting a definition line for any of
 * these fields = `static_core_field_removed` violation. The registry is
 * extensible (future L0S/L2 fields register here) but the registry itself is
 * static-core — removing a registry entry is also a violation.
 */
export const STATIC_CORE_FIELD_REGISTRY: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // RunState schema fields (L0C-T07a)
    "version",
    "current_agent",
    "_current_turn",
    "pending_input",
    "unsent_tool_call_ids_for_interrupted_state",
    "approvals",
    "turnItems",
  ]),
);

/**
 * Threshold field → direction. `higher_is_stricter` means a larger value is
 * stricter (e.g. pass_rate ≥ 0.8 → 0.9 is tightening); `lower_is_stricter`
 * means a smaller value is stricter (e.g. max_cost ≤ 100 → 50 is tightening).
 * Widening (moving toward looser) is a violation; tightening is allowed.
 */
export const THRESHOLD_DIRECTION_REGISTRY: ReadonlyMap<
  string,
  "higher_is_stricter" | "lower_is_stricter"
> = Object.freeze(
  new Map<string, "higher_is_stricter" | "lower_is_stricter">([
    ["acceptance_threshold", "higher_is_stricter"],
    ["pass_rate", "higher_is_stricter"],
    ["min_pass_rate", "higher_is_stricter"],
    ["max_cost", "lower_is_stricter"],
    ["max_latency", "lower_is_stricter"],
  ]),
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aggregateLines(diff: Diff): {
  oldLines: string[];
  newLines: string[];
} {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.oldLines) oldLines.push(line);
    for (const line of hunk.newLines) newLines.push(line);
  }
  return { oldLines, newLines };
}

function detectSafetyDeleted(
  oldLines: string[],
  newLines: string[],
): boolean {
  const hasSafety = (lines: string[]): boolean =>
    lines.some((l) => l.includes("<safety>"));
  return hasSafety(oldLines) && !hasSafety(newLines);
}

const GUARDED_TOOLS = ["bash", "write"] as const;

function detectDenyToAllow(
  oldLines: string[],
  newLines: string[],
): boolean {
  for (const tool of GUARDED_TOOLS) {
    const denyRe = new RegExp(`^\\s*${escapeRegExp(tool)}\\s*:\\s*deny\\b`);
    const allowRe = new RegExp(`^\\s*${escapeRegExp(tool)}\\s*:\\s*allow\\b`);
    const oldDeny = oldLines.some((l) => denyRe.test(l));
    const newAllow = newLines.some((l) => allowRe.test(l));
    if (oldDeny && newAllow) return true;
  }
  return false;
}

function detectRemovedFields(
  oldLines: string[],
  newLines: string[],
): string[] {
  const removed: string[] = [];
  for (const field of STATIC_CORE_FIELD_REGISTRY) {
    const defRe = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:`);
    const oldHas = oldLines.some((l) => defRe.test(l));
    const newHas = newLines.some((l) => defRe.test(l));
    if (oldHas && !newHas) removed.push(field);
  }
  return removed;
}

function firstNumericValue(lines: string[], re: RegExp): number | null {
  for (const line of lines) {
    const m = line.match(re);
    if (m && m[1] !== undefined) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function detectWidenedThresholds(
  oldLines: string[],
  newLines: string[],
): string[] {
  const widened: string[] = [];
  for (const [field, direction] of THRESHOLD_DIRECTION_REGISTRY) {
    const re = new RegExp(
      `^\\s*${escapeRegExp(field)}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`,
    );
    const oldVal = firstNumericValue(oldLines, re);
    const newVal = firstNumericValue(newLines, re);
    if (oldVal === null || newVal === null) continue;
    if (direction === "higher_is_stricter") {
      if (newVal < oldVal) widened.push(field);
    } else {
      if (newVal > oldVal) widened.push(field);
    }
  }
  return widened;
}

function detectResourceRealloc(
  oldLines: string[],
  newLines: string[],
): boolean {
  const ctrlRe = /^\s*control-model\s*:\s*(true|false)\b/;
  const valueOf = (lines: string[]): "true" | "false" | null => {
    for (const line of lines) {
      const m = line.match(ctrlRe);
      if (m && m[1] !== undefined && (m[1] === "true" || m[1] === "false")) {
        return m[1];
      }
    }
    return null;
  };
  const oldVal = valueOf(oldLines);
  const newVal = valueOf(newLines);
  return oldVal === "false" && newVal === "true";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function checkDiff(diff: Diff): PreCommitVerdict {
  const { oldLines, newLines } = aggregateLines(diff);
  const violations: DangerousDiffKind[] = [];
  const reasons: string[] = [];

  if (detectSafetyDeleted(oldLines, newLines)) {
    violations.push("safety_segment_deleted");
    reasons.push("diff deletes a `<safety>` segment line");
  }

  if (detectDenyToAllow(oldLines, newLines)) {
    violations.push("deny_to_allow");
    reasons.push("diff flips a bash/write permission from deny to allow");
  }

  const removedFields = detectRemovedFields(oldLines, newLines);
  if (removedFields.length > 0) {
    violations.push("static_core_field_removed");
    reasons.push(
      `diff removes registered static-core field(s): ${removedFields.join(", ")}`,
    );
  }

  const widenedThresholds = detectWidenedThresholds(oldLines, newLines);
  if (widenedThresholds.length > 0) {
    violations.push("acceptance_threshold_widened");
    reasons.push(
      `diff widens acceptance threshold(s): ${widenedThresholds.join(", ")}`,
    );
  }

  if (detectResourceRealloc(oldLines, newLines)) {
    violations.push("resource_control_model_realloc");
    reasons.push(
      "diff flips resources control-model from false to true",
    );
  }

  const allow = violations.length === 0;
  return { allow, violations, reasons };
}

// ---------------------------------------------------------------------------
// Pre-commit hook installer
// ---------------------------------------------------------------------------

// Real staged-diff interceptor entry point, lives at <repoRoot>/scripts/
// l0c-t08-check-staged.mjs. It reads `git diff --cached --unified=0`, parses
// it into Diff{path, hunks:{oldLines,newLines}}, imports checkDiff from this
// source (via Node --experimental-strip-types; pre-commit.ts depends only on
// node builtins so no bundler is needed), and exits 1 on any violation —
// thereby BLOCKING the commit. This is the real commit-layer guard (spec
// §L0C-T08 installPreCommitHook contract: "调用 checkDiff").
const INTERCEPTOR_REL = "scripts/l0c-t08-check-staged.mjs";

const PRE_COMMIT_HOOK_CONTENT = `#!/usr/bin/env bash
# Pre-commit hook installed by @harness/l0-core (L0C-T08 static-core guard).
#
# Invokes the staged-diff interceptor (scripts/l0c-t08-check-staged.mjs) which
# parses the actual staged ` + "`git diff --cached`" + ` into Diff objects and calls
# checkDiff, rejecting the commit (exit 1) when any dangerous diff kind is
# detected:
#   - safety_segment_deleted
#   - deny_to_allow
#   - static_core_field_removed
#   - acceptance_threshold_widened
#   - resource_control_model_realloc
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
INTERCEPTOR="$REPO_ROOT/${INTERCEPTOR_REL}"

if [[ ! -f "$INTERCEPTOR" ]]; then
  echo "[L0C-T08] staged-diff interceptor not found at $INTERCEPTOR; skipping pre-commit guard" >&2
  exit 0
fi

# Node 22.6+ ships --experimental-strip-types (the interceptor imports checkDiff
# directly from the TypeScript source). Probe the flag once; if the runtime does
# not support it, skip with a warning rather than blocking every commit.
if node --experimental-strip-types --no-warnings -e '' >/dev/null 2>&1; then
  node --experimental-strip-types --no-warnings "$INTERCEPTOR"
else
  echo "[L0C-T08] node runtime lacks --experimental-strip-types; skipping pre-commit guard" >&2
  exit 0
fi
`;

export function installPreCommitHook(repoRoot: string): void {
  const hooksDir = path.join(repoRoot, ".git", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, "pre-commit");
  // Write (overwrites any prior content — idempotent re-install).
  fs.writeFileSync(hookPath, PRE_COMMIT_HOOK_CONTENT, { mode: 0o755 });
  // Force executable bits regardless of prior umask / existing file mode.
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod may fail on odd filesystems; the write mode already set 0o755.
  }
}
