// ISS-24: 逐用例 ID 集合回归基线（替换 GREENS.baseline 计数门）。
// --update: 跑 vitest --reporter=json, 记录全部 passed 用例 ID 到
//           tests/.baseline/passed.json。
// (无参): 校验——基线中任一用例不再 passed 且不在 known-flaky 白名单 → exit 1 (回归)。
// 用例 ID = `<tests/相对路径> > <fullName>`; known-flaky 每条须注明原因。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE_DIR = join(ROOT, "tests", ".baseline");
const BASELINE_FILE = join(BASELINE_DIR, "passed.json");
const FLAKY_FILE = join(BASELINE_DIR, "known-flaky.json");

// ISS-24 唯一 ID 归一化纯函数（baseline 生成与校验共用）。
// 输入 vitest file-result 的 name（mac/linux 绝对路径或相对路径均可）与断言 fullName，
// 输出平台无关 ID：`tests/<相对路径> > <fullName>`。
// 归一化策略：不依赖 checkout 根路径/ROOT 前缀长度，而是锚定路径中的 `/tests/` 段，
// 取该段（含 `tests/` 前缀）为仓库相对前缀；对相对路径（`tests/...` 或 `./tests/...`）
// 亦收敛到同一形态，并容忍 Windows 反斜杠。跨平台一致 = 基线在 mac 生成、ubuntu 校验零漂移。
function normalizeTestId(fr, fullName) {
  const name = String(fr?.name ?? "").replace(/\\/g, "/");
  const marker = "/tests/";
  const i = name.lastIndexOf(marker);
  const rel = i !== -1 ? name.slice(i + 1) : name.replace(/^\.\//, "");
  return `${rel} > ${fullName}`;
}

function runVitest() {
  // 直接以 node 跑工作区 vitest 入口（不依赖 corepack/pnpm shim，跨平台更稳）。
  const vitestEntry = join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const r = spawnSync(process.execPath, [vitestEntry, "run", "--reporter=json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.error("vitest produced no json output");
    process.exit(2);
  }
  return JSON.parse(lines[lines.length - 1]);
}

function passedIds(summary) {
  const ids = [];
  for (const fr of summary.testResults ?? []) {
    for (const ar of fr.assertionResults ?? []) {
      if (ar.status === "passed") ids.push(normalizeTestId(fr, ar.fullName));
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
