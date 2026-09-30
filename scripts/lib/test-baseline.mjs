// ISS-24: 逐用例 ID 集合回归基线（替换 GREENS.baseline 计数门）。
// --update: 跑 vitest --reporter=json, 记录全部 passed 用例 ID (文件 + fullName) 到
//           tests/.baseline/passed.json。
// (无参): 校验——基线中任一用例不再 passed 且不在 known-flaky 白名单 → exit 1 (回归)。
// 用例 ID = `<相对文件> > <fullName>`; known-flaky 每条须注明原因。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE_DIR = join(ROOT, "tests", ".baseline");
const BASELINE_FILE = join(BASELINE_DIR, "passed.json");
const FLAKY_FILE = join(BASELINE_DIR, "known-flaky.json");

function runVitest() {
  const r = spawnSync("pnpm", ["vitest", "run", "--reporter=json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== null && !r.stdout.includes('"numPassedTests"')) {
    // vitest 测试失败也会输出 json summary; 仅当完全无输出才报错
  }
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.error("vitest produced no json output");
    process.exit(2);
  }
  return JSON.parse(lines[lines.length - 1]);
}

function passedIds(summary) {
  const ids = [];
  for (const fr of summary.testResults ?? []) {
    const file = fr.name.startsWith(ROOT) ? fr.name.slice(ROOT.length + 1) : fr.name;
    for (const ar of fr.assertionResults ?? []) {
      if (ar.status === "passed") ids.push(`${file} > ${ar.fullName}`);
    }
  }
  return ids.sort();
}

const summary = runVitest();
const passed = passedIds(summary);
const mode = process.argv[2];

if (mode === "--update") {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify(passed, null, 2) + "\n");
  console.log(`baseline updated: ${passed.length} passing tests`);
} else {
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  const flaky = existsSync(FLAKY_FILE) ? JSON.parse(readFileSync(FLAKY_FILE, "utf8")) : [];
  const flakySet = new Set(flaky);
  const passedSet = new Set(passed);
  const regressed = baseline.filter((id) => !passedSet.has(id) && !flakySet.has(id));
  if (regressed.length > 0) {
    console.error(`::error::Regression: ${regressed.length} baseline tests no longer passing`);
    for (const id of regressed.slice(0, 25)) console.error(`::error::  ${id}`);
    process.exit(1);
  }
  const added = passed.filter((id) => !baseline.includes(id));
  if (added.length > 0) {
    console.warn(`Warning: ${added.length} new passing tests not in baseline — run --update`);
  }
  console.log(`baseline ok: ${passed.length} passed | ${regressed.length} regressed | ${flaky.length} flaky-exempt`);
}
