#!/usr/bin/env node
// PLG-T09: pnpm publish 编排（dry-run 门控 + publishable 校验）。
//
// Spec: execution/plugin/TASKS.md §PLG-T09。
// 行为：
//   1. 逐包校验 packages/evolve-*/package.json（version 独立语义化版本非
//      0.0.0 + publishConfig/files/exports 齐备）——任一不合规即 exit 非 0。
//   2. `pnpm -r publish --dry-run --filter "@harness/evolve-*" --no-git-checks`
//      （--no-git-checks 仅 dry-run 用：避免工作树不净阻断；真实 publish 须净树）。
// 本脚本绝不真实 publish——dry-run only（任务规则 + spec 门控）。

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePackageJson } from "./lib/validate-package.mjs";

const DIST_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO = join(DIST_ROOT, "..", "..");
const PACKAGES_DIR = join(REPO, "packages");

function listEvolvePackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .filter((d) => d.startsWith("evolve-"))
    .map((d) => join(PACKAGES_DIR, d));
}

function fail(message) {
  process.stderr.write(`publish.mjs: ${message}\n`);
  process.exit(1);
}

// ── 1. publishable 字段校验（version 缺失/占位 → exit 非 0，spec 错误路径）──
const pkgDirs = listEvolvePackageDirs();
if (pkgDirs.length === 0) {
  fail("no packages/evolve-* directories found");
}

const summary = [];
for (const pkgDir of pkgDirs) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  } catch (err) {
    fail(`cannot parse ${pkgDir}/package.json: ${err.message}`);
  }
  const verdict = validatePackageJson(pkg, pkgDir);
  if (!verdict.ok) {
    fail(`invalid package: ${verdict.reason}`);
  }
  summary.push(`${pkg.name}@${pkg.version}`);
}

// ── 2. dry-run publish（pnpm -r --filter "@harness/evolve-*"）──────────────
const dryRun = process.argv.includes("--dry-run");
if (!dryRun) {
  fail("refusing to run without --dry-run (this script is dry-run only)");
}

// 沙箱/受限环境下 spawn pnpm（corepack shim）可能被拒（EPERM）或 corepack
// 默认缓存目录（~/.cache/node/corepack）不可读——回退到 `node <pnpm-shim>`
// + 仓库本地 COREPACK_HOME（需入 .gitignore）。正常 CI 环境走直接 spawn。
const DEFAULT_COREPACK = join(homedir(), ".cache", "node", "corepack");

function corepackHomeUsable() {
  try {
    accessSync(DEFAULT_COREPACK, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePnpmShim() {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, "pnpm");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // continue scanning
    }
  }
  return null;
}

function runPnpm(args) {
  let result = spawnSync("pnpm", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || !corepackHomeUsable()) {
    // 回退：node 直接执行 corepack pnpm shim + 仓库本地 corepack 缓存。
    const shim = resolvePnpmShim();
    if (shim) {
      result = spawnSync(process.execPath, [shim, ...args], {
        cwd: REPO,
        env: {
          ...process.env,
          COREPACK_HOME: join(REPO, ".corepack-home"),
          // 沙箱下 ~/.npm 不可写（npm pack 缓存）——回退仓库本地 npm 缓存。
          npm_config_cache: join(REPO, ".npm-cache"),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  }
  return result;
}

const args = [
  "-r",
  "publish",
  "--dry-run",
  "--filter",
  "@harness/evolve-*",
  "--no-git-checks",
];
const result = runPnpm(args);

// pnpm 原始输出走 stderr（可观测）；stdout 只留精简摘要（供调用方断言）。
if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  fail(`cannot spawn pnpm: ${result.error.message}`);
}
if (result.status !== 0) {
  fail(`pnpm publish --dry-run exited ${result.status} — see output above`);
}

process.stdout.write(`[evolve-dist] publishable check ok: ${pkgDirs.length} packages\n`);
for (const line of summary) {
  process.stdout.write(`[evolve-dist] + ${line} (dry-run ok)\n`);
}
process.stdout.write(`[evolve-dist] pnpm publish --dry-run --filter "@harness/evolve-*" --no-git-checks: exit 0\n`);
