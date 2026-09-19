#!/usr/bin/env node
// CE-T01a · canary manifest 行为断言门（spec §CE-T01a 验收#2 + WBS A.3）。
//
// Spec contract (execution/canary-eval/TASKS.md §CE-T01a 验收):
//   "bash scripts/verify.sh CE-T01a   # 校验 canary/manifest.yaml tasks>=30
//    + sha256 一致"
//
// 该脚本兑现 dispatch.sh CE-T01a 路由中遗留的 TODO
// （"# WBS A.3 behavior assert: manifest tasks>=30 + sha256 (lands with task)"）。
// 它直接从 TS 源（Node --experimental-strip-types）导入 loadCanary +
// verifyManifestSha256，对真实的 packages/canary-eval/canary/manifest.yaml
// 做行为断言（非合成 fixture）：
//   1. manifest 文件存在；
//   2. loadCanary 返回 tasks.length >= 30；
//   3. 每任务 decontaminated===true 且 expectedExit===0 且 agentVisible===false；
//   4. verifyManifestSha256(manifestPath)===true（自洽 sha256）。
// 任一不满足 → exit 1。

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const manifestPath = path.resolve(
  repoRoot,
  "packages/canary-eval/canary/manifest.yaml",
);

const loaderPath = path.resolve(
  repoRoot,
  "packages/canary-eval/src/canary/loader.ts",
);
const hashPath = path.resolve(
  repoRoot,
  "packages/canary-eval/src/canary/manifest-hash.ts",
);

const { loadCanary } = await import(pathToFileURL(loaderPath).href);
const { verifyManifestSha256 } = await import(pathToFileURL(hashPath).href);

function fail(msg) {
  console.error(`CE-T01a behavior gate FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`canary/manifest.yaml not found at ${manifestPath}`);
}

let manifest;
try {
  manifest = loadCanary(manifestPath);
} catch (e) {
  fail(`loadCanary threw: ${e?.message ?? e}`);
}

if (manifest.tasks.length < 30) {
  fail(`tasks.length=${manifest.tasks.length} < 30`);
}
for (const t of manifest.tasks) {
  if (t.decontaminated !== true) fail(`task ${t.id} decontaminated !== true`);
  if (t.expectedExit !== 0) fail(`task ${t.id} expectedExit !== 0`);
  if (!t.verify || t.verify.length === 0) fail(`task ${t.id} verify empty`);
  if (!t.repo) fail(`task ${t.id} repo empty`);
  if (!t.frozenInRelease) fail(`task ${t.id} frozenInRelease empty`);
}
if (manifest.agentVisible !== false) {
  fail(`agentVisible !== false (got ${String(manifest.agentVisible)})`);
}

if (verifyManifestSha256(manifestPath) !== true) {
  fail(`verifyManifestSha256 !== true (sha256 not self-consistent)`);
}

console.log(
  `CE-T01a behavior gate PASS: ${manifest.tasks.length} decontaminated tasks, sha256 self-consistent, agentVisible=false`,
);
process.exit(0);
