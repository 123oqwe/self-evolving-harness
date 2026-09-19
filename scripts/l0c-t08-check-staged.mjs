#!/usr/bin/env node
// L0C-T08 · pre-commit staged-diff interceptor.
//
// Spec: execution/L0-core/TASKS.md §L0C-T08 (installPreCommitHook contract:
// the hook must "call checkDiff" — i.e. run checkDiff over the ACTUAL staged
// diff and exit 1 on any dangerous-diff violation).
//
// This script is what the installed pre-commit hook invokes. It:
//   1. reads `git diff --cached --unified=0` from the current git repo,
//   2. parses the unified diff into Diff{path, hunks:{oldLines,newLines}}
//      objects (one per changed file),
//   3. imports checkDiff from the L0C TypeScript source and runs it over each
//      staged Diff,
//   4. prints the violation reasons to stderr and exits 1 when any dangerous
//      kind is detected — thereby BLOCKING the commit. Exits 0 on clean
//      staged diffs.
//
// checkDiff is imported directly from
// packages/l0-core/src/guard/pre-commit.ts via Node's --experimental-strip-types
// loader. pre-commit.ts depends only on node builtins (node:fs / node:path),
// so no bundler is required and no transitive TS cross-imports are pulled in.
//
// The hook (installPreCommitHook) launches this script with
//   node --experimental-strip-types --no-warnings scripts/l0c-t08-check-staged.mjs

import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

// Resolve the real harness repo root from this script's location (NOT from
// cwd) — so the interceptor works when the hook runs inside a worktree or
// when invoked from a temp repo by the verify-block gate.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const checkDiffModulePath = path.resolve(
  repoRoot,
  "packages/l0-core/src/guard/pre-commit.ts",
);

let checkDiff;
try {
  const mod = await import(pathToFileURL(checkDiffModulePath).href);
  checkDiff = mod.checkDiff;
} catch (err) {
  // Cannot load checkDiff (e.g. source removed / Node cannot strip TS types).
  // Fail CLOSED for a security guard: block the commit and surface the cause.
  console.error(
    `[L0C-T08] fatal: could not load checkDiff from ${checkDiffModulePath}: ${
      err && err.message ? err.message : err
    }`,
  );
  process.exit(1);
}

if (typeof checkDiff !== "function") {
  console.error(
    `[L0C-T08] fatal: checkDiff is not exported from ${checkDiffModulePath}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Unified-diff parser (line-level, --unified=0). Produces one Diff per file.
// Detectors operate on aggregated oldLines/newLines per file.
// ---------------------------------------------------------------------------

function parseUnifiedDiff(text) {
  const diffs = [];
  let current = null; // { path: string, hunks: [] }
  let currentHunk = null;

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      if (current) diffs.push(current);
      current = { path: "", hunks: [] };
      currentHunk = null;
      continue;
    }
    if (
      raw.startsWith("index ") ||
      raw.startsWith("similarity index ") ||
      raw.startsWith("rename from ") ||
      raw.startsWith("rename to ") ||
      raw.startsWith("new file ") ||
      raw.startsWith("deleted file ") ||
      raw.startsWith("old mode ") ||
      raw.startsWith("new mode ") ||
      raw.startsWith("Binary files ") ||
      raw.startsWith("\\ No newline at end of file")
    ) {
      continue;
    }
    if (raw.startsWith("--- ")) {
      continue; // old file marker; path captured from +++ line
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).replace(/^[ab]\//, "");
      if (current) current.path = p;
      continue;
    }
    if (raw.startsWith("@@")) {
      if (!current) current = { path: "", hunks: [] };
      currentHunk = { oldLines: [], newLines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk === null) continue;
    if (raw.startsWith("-")) {
      currentHunk.oldLines.push(raw.slice(1));
    } else if (raw.startsWith("+")) {
      currentHunk.newLines.push(raw.slice(1));
    }
    // context lines (leading space) and blank lines ignored.
  }
  if (current) diffs.push(current);

  return diffs.filter((d) => d.path && d.hunks.length > 0);
}

// ---------------------------------------------------------------------------
// Main: read staged diff, run checkDiff, block on violation.
// ---------------------------------------------------------------------------

let stagedDiffText;
try {
  stagedDiffText = execSync("git diff --cached --unified=0", {
    encoding: "utf8",
    maxBuffer: 1 << 26, // 64 MiB
  });
} catch (err) {
  // Not a git repo / git unavailable — nothing to check, allow the commit.
  process.exit(0);
}

if (!stagedDiffText || !stagedDiffText.trim()) {
  // No staged changes — nothing to guard.
  process.exit(0);
}

const diffs = parseUnifiedDiff(stagedDiffText);
let blocked = false;

for (const diff of diffs) {
  const verdict = checkDiff(diff);
  if (!verdict.allow) {
    blocked = true;
    console.error(
      `[L0C-T08] commit BLOCKED — dangerous diff in ${diff.path}:`,
    );
    for (const v of verdict.violations) {
      console.error(`  - ${v}`);
    }
    for (const r of verdict.reasons) {
      console.error(`  · ${r}`);
    }
  }
}

process.exit(blocked ? 1 : 0);
