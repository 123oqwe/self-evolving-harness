#!/usr/bin/env node
// scripts/lib/test-lock-check.mjs — TEST-LOCK §1.2 sha256 enforcement gate.
//
// Contract (TEST-LOCK.md §1.2):
//   "implementer 领单时由 verify.sh 或 test-lock 门重新计算 sha256 并与本表
//    比对——hash 不变 = 锁定完好。"
//
// This script is the code-level realization of that contract. It parses the
// §2 lock table (path + sha256 pairs) out of TEST-LOCK.md, recomputes the
// sha256 of every locked test file on disk, and fails (exit 1) on:
//   (a) hash mismatch  — a locked file was edited (test-lock-violation),
//   (b) missing file   — a locked file was deleted/renamed,
//   (c) extra file     — a *.spec.ts under tests/ exists but is NOT in the
//                        lock table (implementer added an unlocked test).
//
// Prior to this gate the sha256 lock was a social contract enforced only by
// the reviewer; in autonomous impl mode (no reviewer / reviewer bypassed) an
// implementer could silently turn RED locked tests green and verify.sh would
// still exit 0. This script closes that hole at three layers:
//   1. scripts/verify.sh          — runs this check at entry (per-task领单).
//   2. .github/workflows/ci.yml   — dedicated test-lock job (non-bypassable).
//   3. .git/hooks/pre-commit      — installed via scripts/install-pre-commit.sh.
//
// Usage:
//   node scripts/lib/test-lock-check.mjs [--quiet]
//   node scripts/lib/test-lock-check.mjs --file tests/L0C/T02-turn.spec.ts
//       (--file restricts the check to the canonical hash of one locked file;
//        returns 1 if that file is not in the table or its hash differs.)
//
// Exit codes:
//   0  all locked files intact, no stray test files
//   1  at least one violation (mismatch / missing / extra)
//   2  usage error / TEST-LOCK.md unreadable

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
let quiet = false;
let onlyFile = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--quiet") quiet = true;
  else if (a === "--file") onlyFile = args[++i];
  else if (a === "-h" || a === "--help") {
    process.stdout.write(
      `usage: test-lock-check.mjs [--quiet] [--file <path>]\n` +
        `  Verifies sha256 of locked test files against TEST-LOCK.md §2.\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(`test-lock-check: unknown arg '${a}'\n`);
    process.exit(2);
  }
}

// Resolve repo root from CWD: walk up until TEST-LOCK.md is found.
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "TEST-LOCK.md"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // Fallback: assume script location ../../
  const scriptDir = new URL("..", import.meta.url).pathname;
  if (existsSync(join(scriptDir, "TEST-LOCK.md"))) return scriptDir;
  return start;
}

const repoRoot = findRepoRoot(process.cwd());
const lockDocPath = join(repoRoot, "TEST-LOCK.md");

if (!existsSync(lockDocPath)) {
  process.stderr.write(`test-lock-check: TEST-LOCK.md not found (looked at ${lockDocPath})\n`);
  process.exit(2);
}

const doc = readFileSync(lockDocPath, "utf8");

// Parse §2 table rows. Each row is a 3-column markdown table:
//   | <task-id> | `<test-file.spec.ts>` | `<64-hex-sha256>` |
// We capture the file-path + sha columns by matching the trailing two
// backtick-quoted cells (non-anchored, so the leading task-id column is
// skipped regardless of its width / content).
const ROW_RE = /\|\s*`([^`|]+\.spec\.ts)`\s*\|\s*`([0-9a-f]{64})`\s*\|/g;

/** @type {Array<{path:string, sha:string}>} */
const table = [];
let m;
while ((m = ROW_RE.exec(doc)) !== null) {
  table.push({ path: m[1], sha: m[2] });
}

if (table.length === 0) {
  process.stderr.write("test-lock-check: parsed 0 rows from TEST-LOCK.md §2 — parser broken?\n");
  process.exit(2);
}

function sha256(absPath) {
  const buf = readFileSync(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

// Recursively collect every *.spec.ts under tests/.
function collectSpecTs(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectSpecTs(p, acc);
    else if (p.endsWith(".spec.ts")) acc.push(p);
  }
  return acc;
}

// ── --file mode: verify one file against its canonical hash ─────────────────
if (onlyFile !== null) {
  const rel = relative(repoRoot, onlyFile);
  const row = table.find((r) => r.path === rel || r.path === onlyFile);
  if (!row) {
    process.stderr.write(`test-lock-check: ${rel} is NOT in TEST-LOCK.md §2 (unlocked file)\n`);
    process.exit(1);
  }
  if (!existsSync(onlyFile)) {
    process.stderr.write(`test-lock-check: ${rel} missing on disk (locked file deleted)\n`);
    process.exit(1);
  }
  const actual = sha256(onlyFile);
  if (actual !== row.sha) {
    process.stderr.write(
      `test-lock-check: HASH MISMATCH ${rel}\n  table:  ${row.sha}\n  actual: ${actual}\n`,
    );
    process.exit(1);
  }
  if (!quiet) process.stdout.write(`test-lock-check: ${rel} intact (${actual.slice(0, 12)})\n`);
  process.exit(0);
}

// ── full mode: verify the whole lock table + stray-file detection ────────────
const violations = [];
const seenPaths = new Set();

for (const row of table) {
  seenPaths.add(row.path);
  const abs = join(repoRoot, row.path);
  if (!existsSync(abs)) {
    violations.push({ kind: "missing", path: row.path, table: row.sha, actual: "<missing>" });
    continue;
  }
  const actual = sha256(abs);
  if (actual !== row.sha) {
    violations.push({ kind: "mismatch", path: row.path, table: row.sha, actual });
  }
}

// Stray-file detection: every *.spec.ts under tests/ must be locked in the table.
const testsDir = join(repoRoot, "tests");
if (existsSync(testsDir)) {
  const onDisk = collectSpecTs(testsDir).map((abs) => relative(repoRoot, abs));
  for (const rel of onDisk.sort()) {
    if (!seenPaths.has(rel)) {
      violations.push({ kind: "extra", path: rel, table: "<none>", actual: "<unlocked>" });
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `test-lock-check: ${violations.length} violation(s) — TEST-LOCK §1.2 broken\n`,
  );
  for (const v of violations) {
    if (v.kind === "mismatch") {
      process.stderr.write(
        `  [mismatch] ${v.path}\n    table:  ${v.table}\n    actual: ${v.actual}\n`,
      );
    } else if (v.kind === "missing") {
      process.stderr.write(`  [missing] ${v.path} — locked file not on disk\n`);
    } else {
      process.stderr.write(`  [extra]   ${v.path} — *.spec.ts not in TEST-LOCK.md §2\n`);
    }
  }
  process.stderr.write(
    "test-lock-check: implementer must NOT edit tests/; use the test-author appeal channel (§1.2).\n",
  );
  process.exit(1);
}

if (!quiet) {
  process.stdout.write(`test-lock-check: ${table.length} locked files intact, 0 violations\n`);
}
process.exit(0);
