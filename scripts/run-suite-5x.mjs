#!/usr/bin/env node
// OPS-T03 · flaky 用例定位 — 连续跑全套件 N 次 + diff pass/fail 矩阵 + 定位 flake
//
// 两种模式：
//   1. 离线 diff（可测、无副作用、被 tests/adapt/OPS-T03-flaky-locator.spec.ts 钉死）：
//        node scripts/run-suite-5x.mjs --diff <runs-dir> --out <report.md> --runs <N>
//      读取 <runs-dir>/run-1.json ... run-N.json（vitest json reporter 形状），
//      diff 出结果跨 run 不一致的用例（flake），写报告到 --out。
//
//   2. 真实 5x 执行（本地用，产出 reports/flaky-locator-001.md 的原始数据）：
//        node scripts/run-suite-5x.mjs --run --runs 5 --out-dir <tmp>
//      连续跑 `pnpm vitest run --reporter=json` N 次，每次 stdout 落
//      <out-dir>/run-<i>.json，再调 diff 模式生成报告。
//
// vitest json reporter 形状（jest-compatible）：
//   { testResults: [{ name, assertionResults: [{ fullName, status }] }] }
//   status ∈ "passed" | "failed" | "skipped" | "todo" | "running"
//
// flake 判定（spec §OPS-T03）：
//   - 收集某用例跨 run 的非 skipped 状态集合；
//   - skipped 不计为抖动（skip ≠ flake）；
//   - 非 skipped 状态集合大小 ≥ 2（即结果跨 run 不一致）→ flake；
//   - 单次 fail + 4 次 pass 仍算 flake（结果跨 run 不一致即 flake）。
//
// 纯 node 无依赖；不新增 npm 包。

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

// ── CLI 解析 ────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    diff: { type: "string" },
    "out": { type: "string" },
    runs: { type: "string", default: "5" },
    run: { type: "boolean", default: false },
    "out-dir": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositional: false,
});

if (values.help) {
  process.stdout.write(
    `Usage:
  run-suite-5x.mjs --diff <runs-dir> --out <report.md> [--runs N]   # offline diff
  run-suite-5x.mjs --run [--runs N] [--out-dir <dir>]               # real 5x exec
`);
  process.exit(0);
}

const RUNS = Math.max(1, parseInt(values.runs || "5", 10) || 5);

// ── 解析单次 vitest json reporter 输出 ─────────────────────────────────────
/**
 * @param {string} raw
 * @returns {Map<string,string>} fullName -> status
 */
function parseVitestJson(raw) {
  const obj = JSON.parse(raw);
  const out = new Map();
  const files = Array.isArray(obj.testResults) ? obj.testResults : [];
  for (const file of files) {
    const cases = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const c of cases) {
      if (c && typeof c.fullName === "string") {
        out.set(c.fullName, c.status);
      }
    }
  }
  return out;
}

/**
 * 读取 <dir>/run-<i>.json，解析失败 → null（调用方 warn 跳过）。
 */
function loadRun(dir, idx) {
  const file = join(dir, `run-${idx}.json`);
  if (!existsSync(file)) return { ok: false, file, reason: "missing", data: null };
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, file, reason: `read-error: ${e.message}`, data: null };
  }
  try {
    return { ok: true, file, reason: null, data: parseVitestJson(raw) };
  } catch (e) {
    return { ok: false, file, reason: `parse-error: ${e.message}`, data: null };
  }
}

// ── diff 核心：聚合 N 次 run → 矩阵 + flake 判定 ───────────────────────────
/**
 * @param {Array<{ok:boolean,file:string,reason:string|null,data:Map<string,string>|null}>} runs
 * @returns {{
 *   validRuns: number[],
 *   tests: Map<string, { statuses: string[], perRun: (string|undefined)[] }>,
 *   flakes: string[],
 *   stable: string[],
 *   skippedAll: string[],
 * }}
 */
function buildMatrix(runs) {
  const validRuns = []; // 1-indexed run numbers that parsed ok
  const tests = new Map(); // fullName -> { statuses: string[], perRun: (string|undefined)[] }

  runs.forEach((r, i) => {
    const runNo = i + 1;
    if (!r.ok || !r.data) return;
    validRuns.push(runNo);
    for (const [fullName, status] of r.data.entries()) {
      let entry = tests.get(fullName);
      if (!entry) {
        entry = { statuses: [], perRun: new Array(runs.length).fill(undefined) };
        tests.set(fullName, entry);
      }
      entry.perRun[i] = status;
      // skipped 不计入抖动判定
      if (status !== "skipped" && status !== "todo") {
        entry.statuses.push(status);
      }
    }
  });

  const flakes = [];
  const stable = [];
  const skippedAll = [];
  for (const [fullName, entry] of tests) {
    const distinct = new Set(entry.statuses);
    if (entry.statuses.length === 0) {
      // 全 skipped（或仅 skipped）→ 不计 flake
      skippedAll.push(fullName);
    } else if (distinct.size >= 2) {
      flakes.push(fullName);
    } else {
      stable.push(fullName);
    }
  }

  return { validRuns, tests, flakes, stable, skippedAll };
}

// ── 报告渲染 ───────────────────────────────────────────────────────────────
function statusCell(s) {
  if (s === undefined) return "—";
  if (s === "passed") return "✅";
  if (s === "failed") return "❌";
  if (s === "skipped") return "⏭️";
  if (s === "todo") return "todo";
  return s;
}

function renderReport(runs, matrix, runsArg) {
  const { validRuns, tests, flakes, stable, skippedAll } = matrix;
  const totalTests = tests.size;
  const flakeCount = flakes.length;
  const hasFlake = flakeCount > 0;
  const skippedRuns = runs
    .map((r, i) => ({ runNo: i + 1, r }))
    .filter(({ r }) => !r.ok);

  const lines = [];
  lines.push("# OPS-T03 · flaky 用例定位报告");
  lines.push("");
  lines.push("> 由 `scripts/run-suite-5x.mjs` 自动生成。");
  lines.push("");
  lines.push("## 概要");
  lines.push("");
  lines.push(`- 运行次数 (runs): ${runsArg}`);
  lines.push(`- 成功解析的 run: ${validRuns.length} / ${runsArg}`);
  lines.push(`- 跳过的 run (解析失败): ${skippedRuns.length}`);
  lines.push(`- 用例总数: ${totalTests}`);
  lines.push(`- flake 用例数: ${flakeCount}`);
  lines.push(`- 状态: ${hasFlake ? `flake detected (${flakeCount} 个用例结果跨 run 不一致)` : "no flake detected"}`);
  lines.push("");

  if (skippedRuns.length > 0) {
    lines.push("## 跳过的 run (warn)");
    lines.push("");
    for (const { runNo, r } of skippedRuns) {
      lines.push(`- run-${runNo}: ${r.file} — ${r.reason} (跳过 + warn，不崩)`);
    }
    lines.push("");
  }

  // pass/fail 矩阵：列 run-1..run-N
  lines.push("## pass/fail 矩阵");
  lines.push("");
  const header = ["用例"];
  for (let i = 1; i <= runsArg; i++) header.push(`run-${i}`);
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const [fullName, entry] of tests) {
    const row = [fullName];
    for (let i = 0; i < runsArg; i++) row.push(statusCell(entry.perRun[i]));
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");

  if (hasFlake) {
    lines.push("## flake 用例 (结果跨 run 不一致)");
    lines.push("");
    for (const f of flakes.sort()) {
      const entry = tests.get(f);
      const tally = {};
      for (const s of entry.statuses) tally[s] = (tally[s] || 0) + 1;
      const tallyStr = Object.entries(tally).map(([k, v]) => `${k}×${v}`).join(", ");
      lines.push(`- ${f}  (${tallyStr})`);
    }
    lines.push("");
  } else {
    lines.push("## flake 用例");
    lines.push("");
    lines.push("no flake detected — 所有用例跨 run 结果一致。");
    lines.push("");
  }

  lines.push("## stable 用例 (结果跨 run 一致)");
  lines.push("");
  if (stable.length === 0) {
    lines.push("(无)");
  } else {
    for (const s of stable.sort()) lines.push(`- ${s}`);
  }
  lines.push("");

  if (skippedAll.length > 0) {
    lines.push("## 全 skipped 用例 (skip ≠ flake)");
    lines.push("");
    for (const s of skippedAll.sort()) lines.push(`- ${s}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── 离线 diff 模式 ──────────────────────────────────────────────────────────
function diffMode(runsDir, outFile, runsArg) {
  const runs = [];
  for (let i = 1; i <= runsArg; i++) {
    const r = loadRun(runsDir, i);
    if (!r.ok) {
      process.stderr.write(`[warn] run-${i} 跳过: ${r.file} — ${r.reason}\n`);
    }
    runs.push(r);
  }
  const matrix = buildMatrix(runs);
  const report = renderReport(runs, matrix, runsArg);
  writeFileSync(outFile, report, "utf8");
  process.stdout.write(`[ok] 报告已写入 ${outFile} (flakes=${matrix.flakes.length})\n`);
}

// ── 真实 5x 执行模式 ────────────────────────────────────────────────────────
function runMode(runsArg, outDir) {
  const dir = outDir || join(process.cwd(), "reports", "flake-runs");
  for (let i = 1; i <= runsArg; i++) {
    const outFile = join(dir, `run-${i}.json`);
    process.stdout.write(`[run ${i}/${runsArg}] pnpm vitest run --reporter=json → ${outFile}\n`);
    let stdout;
    try {
      stdout = execFileSync(
        "pnpm",
        ["vitest", "run", "--reporter=json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 256 },
      );
    } catch (e) {
      // vitest 非 0 exit 仍输出 json 到 stdout；捕获 stdout
      stdout = e.stdout ? e.stdout.toString() : "";
      if (!stdout.trim().startsWith("{")) {
        process.stderr.write(`[warn] run-${i} 无 json 输出: ${e.message}\n`);
        writeFileSync(outFile, "{}", "utf8");
        continue;
      }
    }
    writeFileSync(outFile, stdout, "utf8");
  }
  // diff
  const reportOut = join(dir, "flaky-locator-001.md");
  diffMode(dir, reportOut, runsArg);
}

// ── 主入口 ──────────────────────────────────────────────────────────────────
function main() {
  if (values.run) {
    runMode(RUNS, values["out-dir"]);
    return;
  }
  if (values.diff) {
    if (!values.out) {
      process.stderr.write("--diff 模式需要 --out <report.md>\n");
      process.exit(2);
    }
    diffMode(resolve(values.diff), resolve(values.out), RUNS);
    return;
  }
  process.stderr.write("需要 --diff 或 --run 模式。--help 查看用法。\n");
  process.exit(2);
}

main();
