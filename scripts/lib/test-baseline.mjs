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

// ISS-28: CLI 参数（--from-json 注入摘要 / --baseline-dir 自定义基线目录）。
const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const BASELINE_DIR = argValue("--baseline-dir") ?? join(ROOT, "tests", ".baseline");
const BASELINE_FILE = join(BASELINE_DIR, "passed.json");
// ISS-28: 基线生成时被平台门控 skip 的用例（CI 上会真跑的后备集合）。
const SKIPPED_FILE = join(BASELINE_DIR, "skipped.json");
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

function statusMap(summary) {
  // id → 状态（passed/failed/skipped/todo/disabled/pending）。
  const m = new Map();
  for (const fr of summary.testResults ?? []) {
    for (const ar of fr.assertionResults ?? []) {
      m.set(normalizeTestId(fr, ar.fullName), ar.status);
    }
  }
  return m;
}

// ISS-28: 摘要来源——--from-json 注入（测试用，不跑全量）或真跑 vitest。
function readSummary() {
  const injected = argValue("--from-json");
  if (injected) return JSON.parse(readFileSync(injected, "utf8"));
  return runVitest();
}

const summary = readSummary();
const byStatus = statusMap(summary);
const passed = [...byStatus.entries()].filter(([, s]) => s === "passed").map(([id]) => id).sort();
// ISS-28: 本次被 skip/todo 的用例（--update 时写入 skipped.json 作基线）。
const skippedIds = [...byStatus.entries()]
  .filter(([, s]) => s === "skipped" || s === "todo" || s === "pending" || s === "disabled")
  .map(([id]) => id)
  .sort();
const mode = argv.includes("--update") ? "--update" : undefined;

if (mode === "--update") {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify(passed, null, 2) + "\n");
  writeFileSync(SKIPPED_FILE, JSON.stringify(skippedIds, null, 2) + "\n");
  console.log(
    `baseline updated: ${passed.length} passing, ${skippedIds.length} skipped-at-baseline`,
  );
} else {
  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
    : [];
  const skippedAtBaseline = existsSync(SKIPPED_FILE)
    ? JSON.parse(readFileSync(SKIPPED_FILE, "utf8"))
    : [];
  const flaky = existsSync(FLAKY_FILE) ? JSON.parse(readFileSync(FLAKY_FILE, "utf8")) : [];
  const flakySet = new Set(flaky);

  // ISS-28 盲点：基线生成时被 skip（平台门控）但 CI 上会真跑的用例，
  // 若本次 FAILED 则必须报回归（否则静默不可见）。
  const blindspotFailed = skippedAtBaseline.filter((id) => {
    if (flakySet.has(id)) return false;
    return byStatus.get(id) === "failed";
  });
  // 基线 skip 但本次通过 → 提示更新基线（不红）。
  const newlyPassing = skippedAtBaseline.filter(
    (id) => byStatus.get(id) === "passed" && !baseline.includes(id),
  );

  const regressed = baseline.filter((id) => {
    if (flakySet.has(id)) return false;     // known-flaky 豁免（网络/资源敏感，见 known-flaky.json）
    const s = byStatus.get(id);
    if (s === "failed") return true;        // 真正回归：baseline 用例现在失败
    if (s === undefined) return true;       // 用例消失（文件删除/改名）→ 回归
    return false;                           // passed/skipped/todo/pending → 容忍(平台门控)
  });
  const skipped = baseline.filter((id) => {
    const s = byStatus.get(id);
    return s === "skipped" || s === "todo" || s === "pending" || s === "disabled";
  });
  if (regressed.length > 0 || blindspotFailed.length > 0) {
    if (regressed.length > 0) {
      console.error(`::error::Regression: ${regressed.length} baseline tests now failed/missing`);
      for (const id of regressed.slice(0, 40)) console.error(`::error::  ${id}`);
    }
    if (blindspotFailed.length > 0) {
      console.error(
        `::error::Regression: ${blindspotFailed.length} skipped-at-baseline tests now FAILED (ISS-28 blindspot)`,
      );
      for (const id of blindspotFailed.slice(0, 40)) console.error(`::error::  ${id}`);
    }
    process.exit(1);
  }
  if (newlyPassing.length > 0) {
    console.warn(
      `Note: ${newlyPassing.length} tests skipped at baseline now pass — run --update to add them to baseline (not in baseline yet)`,
    );
    for (const id of newlyPassing.slice(0, 10)) console.warn(`  ${id}`);
  }
  if (skipped.length > 0) {
    console.warn(`Note: ${skipped.length} baseline tests skipped/todo on this platform (tolerated)`);
  }
  const added = passed.filter((id) => !baseline.includes(id));
  if (added.length > 0) {
    console.warn(`Warning: ${added.length} new passing tests not in baseline — run --update`);
  }
  console.log(
    `baseline ok: ${passed.length} passed | ${regressed.length} regressed | ${blindspotFailed.length} blindspot-failed | ${skipped.length} skipped-tolerated | ${flaky.length} flaky-exempt`,
  );
}
