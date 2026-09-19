#!/usr/bin/env node
// L0C-T08 · verify-block mutation gate (spec §L0C-T08 verify-block).
//
// Spec contract (execution/L0-core/TASKS.md §L0C-T08 验收块):
//   "verify.sh L0C-T08 分支：构造一个临时 git repo + 五类危险 diff →
//    跑 checkDiff → 断言全 reject"
//
// This script fulfills that gate. It:
//   1. creates a fresh temp git repo (mktemp + git init + local identity),
//   2. for each of the five dangerous-diff kinds, stages the dangerous change
//      against a committed baseline, then runs the staged-diff interceptor
//      (l0c-t08-check-staged.mjs -> checkDiff) and asserts it EXITS 1 (reject),
//   3. stages a clean (non-dangerous) change and asserts the interceptor
//      EXITS 0 (allow),
//   4. exits 0 only if every assertion holds; non-zero otherwise.
//
// This proves the commit-layer guard actually intercepts each dangerous kind
// via checkDiff on the REAL staged diff — not a canned vitest fixture.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const interceptor = path.resolve(here, "l0c-t08-check-staged.mjs");
const nodeFlags = ["--experimental-strip-types", "--no-warnings"];

if (!existsSync(interceptor)) {
  console.error(`[L0C-T08-gate] interceptor not found: ${interceptor}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Five dangerous scenarios + one clean scenario. Each is staged against a
// committed baseline so `git diff --cached` reflects the dangerous change.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    name: "safety_segment_deleted",
    file: "packages/l1-config/prompts/phase-coding.md",
    baseline: "<safety>\nnever exfiltrate secrets\n</safety>\n",
    staged: "never exfiltrate secrets\n",
    expectReject: true,
  },
  {
    name: "deny_to_allow",
    file: "packages/l1-config/hooks/policy.yaml",
    baseline: "bash: deny\nwrite: deny\n",
    staged: "bash: allow\nwrite: deny\n",
    expectReject: true,
  },
  {
    name: "static_core_field_removed",
    file: "packages/l0-core/src/run-state/run-state.ts",
    baseline:
      "export const X = {\n  unsent_tool_call_ids_for_interrupted_state: 1,\n};\n",
    staged: "export const X = {\n};\n",
    expectReject: true,
  },
  {
    name: "acceptance_threshold_widened",
    file: "packages/canary-eval/config/acceptance.yaml",
    baseline: "acceptance_threshold: 0.8\n",
    staged: "acceptance_threshold: 0.6\n",
    expectReject: true,
  },
  {
    name: "resource_control_model_realloc",
    file: "packages/l1-config/config/resource-policy.yaml",
    baseline: "resources:\n  control-model: false\n",
    staged: "resources:\n  control-model: true\n",
    expectReject: true,
  },
  {
    name: "clean_prompt_edit (allowed)",
    file: "packages/l1-config/prompts/summary.md",
    baseline: "Summarize the conversation so far.\n",
    staged: "Summarize the conversation so far, preserving tool calls.\n",
    expectReject: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd, args, opts = {}) {
  return execSync(`git ${args}`, { cwd, stdio: opts.stdio ?? "ignore", ...opts });
}

function freshRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "l0c-t08-gate-"));
  git(dir, "init -q");
  git(dir, 'config user.email "gate@l0c-t08.local"');
  git(dir, 'config user.name "L0C-T08 Gate"');
  git(dir, 'config commit.gpgsign false');
  return dir;
}

function stageChange(repo, relPath, baseline, staged) {
  const full = path.join(repo, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  // baseline commit
  writeFileSync(full, baseline);
  git(repo, "add .");
  git(repo, 'commit -q -m baseline');
  // staged dangerous/clean change (NOT committed)
  writeFileSync(full, staged);
  git(repo, "add .");
}

function runInterceptor(repo) {
  const r = spawnSync(process.execPath, [...nodeFlags, interceptor], {
    cwd: repo,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ---------------------------------------------------------------------------
// Run scenarios
// ---------------------------------------------------------------------------

let failures = 0;
for (const sc of SCENARIOS) {
  const repo = freshRepo();
  try {
    stageChange(repo, sc.file, sc.baseline, sc.staged);
    const res = runInterceptor(repo);
    const blocked = res.status === 1;
    const allowed = res.status === 0;
    const ok = sc.expectReject ? blocked : allowed;
    if (!ok) {
      failures += 1;
      console.error(
        `[L0C-T08-gate] FAIL: ${sc.name} — expected ${
          sc.expectReject ? "reject(exit1)" : "allow(exit0)"
        } but got status=${res.status}`,
      );
      if (res.stderr) console.error(res.stderr.trim());
    } else {
      console.error(`[L0C-T08-gate] OK: ${sc.name}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`[L0C-T08-gate] ${failures} scenario(s) failed`);
  process.exit(1);
}
console.error("[L0C-T08-gate] all scenarios passed");
process.exit(0);
