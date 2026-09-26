#!/usr/bin/env node
// OPS-T02: metrics 聚合 — 聚合 reports/*.md 的进化指标
// (canary lift / retain 数 / token 效率) 输出 metrics.json + 趋势表
// (reports/metrics-trend.md)。
//
// Spec: execution/adapt/TASKS.md §OPS-T02
// 纯 node 实现（无 npm 依赖）：正则解析 markdown 固定字段。
//
// CLI:
//   node scripts/metrics.mjs --reports <reportsDir> --out <metricsJson>
//
// 字段约定（与 REAL-T02/REAL-T03 报告固定字段对齐）：
//   lift: <number> | lift: n/a (reject)
//   retained: <int>
//   rejected: <int>
//   tokens: <int>
//   decision: accept | reject
//
// REAL-T02 报告在「## 8. 最终结论」段以散文行 `**decision: ACCEPT (no-regression)，
// lift = Δresolve_rate = 0.0000**` 记录结论（markdown 粗体、大写、lift 内联为 `lift = … = X`）。
// 为使聚合在真实报告上非空（不可蒙混），metrics.mjs 在文末追加的机器可解析块
// （`## metrics (machine-parseable)`）为准；同时解析器对粗体/大写/内联 lift 容忍，
// 即便缺少机器块也能从散文 decision 行判定 accept/reject + 提取 lift。
//
// 行为不变量：
//   - 报告缺 decision 字段（无法判定 accept/reject）→ 该 run 跳过 + warn，不崩。
//   - reject 报告（lift 非数字）→ lift:null + decision:reject，不计入 totalLift。
//   - 空 reports/ → metrics.json {runs:[],summary:{...0}} + 趋势表 "no runs"，exit 0。

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { argv, exit, stderr } from "node:process";

// ── argv 解析 ────────────────────────────────────────────────────────────
function parseArgs(args) {
  const opts = { reports: null, out: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--reports") opts.reports = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: node scripts/metrics.mjs --reports <reportsDir> --out <metricsJson>\n",
      );
      exit(0);
    }
  }
  if (!opts.reports || !opts.out) {
    stderr.write(
      "error: --reports and --out are required\n" +
        "usage: node scripts/metrics.mjs --reports <reportsDir> --out <metricsJson>\n",
    );
    exit(2);
  }
  return opts;
}

// ── 纯函数：从 markdown 文本提取单个数值/字段 ────────────────────────────
// 返回 string | null（未匹配）。调用方按需转换。
export function extractMetric(md, field) {
  // field 形如 "lift" / "retained" / "decision"。
  // 匹配行内 `<field>: <value>`，容忍行首/行尾 markdown 粗体 `**` 包裹
  // （REAL-T02 散文结论行写作 `**decision: ACCEPT ...**`），value 取到行尾。
  const re = new RegExp(`^\\s*\\**\\s*${field}:\\s*(.+?)\\s*\\**\\s*$`, "im");
  const m = re.exec(md);
  if (!m) return null;
  // 剥离残留的 markdown 强调符号。
  return m[1].trim().replace(/^\*+|\*+$/g, "").trim();
}

function extractNumber(md, field) {
  const raw = extractMetric(md, field);
  if (raw !== null) {
    // 仅取首个数字（含小数/负号）；非数字（如 "n/a (reject)"）→ null。
    const num = /^(-?\d+(?:\.\d+)?)/.exec(raw);
    if (num) return Number(num[1]);
  }
  // 回退：REAL-T02 散文将 lift 内联写作 `lift = Δresolve_rate = 0.0000`（无冒号）。
  // 仅当无 `lift:` 行时启用，避免与机器块冲突。
  if (field === "lift") {
    const m2 = /lift\s*=\s*\S+\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(md);
    if (m2) return Number(m2[1]);
  }
  return null;
}

function extractInt(md, field, fallback = 0) {
  const raw = extractMetric(md, field);
  if (raw === null) return fallback;
  const num = /^(-?\d+)/.exec(raw);
  return num ? parseInt(num[1], 10) : fallback;
}

function extractDecision(md) {
  const raw = extractMetric(md, "decision");
  if (raw === null) return null;
  // REAL-T02 写 `ACCEPT (no-regression)` 或 `REJECT_ALL`；前缀匹配 accept/reject
  // 即可（REJECT_ALL → reject）。
  const m = /^(accept|reject)/i.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

// ── 单份报告 → run 记录（或 null = 跳过） ─────────────────────────────────
function parseReport(filename, md) {
  const decision = extractDecision(md);
  // 关键字段缺失（无 decision）→ 跳过 + warn，不崩。
  if (decision === null) {
    stderr.write(`warn: ${filename} skipped — missing/invalid decision field\n`);
    return null;
  }
  const lift = extractNumber(md, "lift"); // accept 报告无 lift → null；reject → null
  const retained = extractInt(md, "retained", 0);
  const rejected = extractInt(md, "rejected", 0);
  const tokensUsed = extractInt(md, "tokens", 0);
  return {
    report: filename,
    lift,
    retained,
    rejected,
    tokensUsed,
    decision,
  };
}

// ── 扫描 reports/ 收集 runs ────────────────────────────────────────────────
function collectRuns(reportsDir) {
  const runs = [];
  if (!existsSync(reportsDir)) {
    return runs;
  }
  let entries = [];
  try {
    entries = readdirSync(reportsDir);
  } catch {
    return runs;
  }
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  for (const f of mdFiles) {
    // 跳过本脚本自身产出的趋势表，避免自引用。
    if (f === "metrics-trend.md") continue;
    const full = join(reportsDir, f);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let md;
    try {
      md = readFileSync(full, "utf8");
    } catch (e) {
      stderr.write(`warn: ${f} unreadable: ${e.message}\n`);
      continue;
    }
    const run = parseReport(f, md);
    if (run) runs.push(run);
  }
  return runs;
}

// ── 聚合 summary ───────────────────────────────────────────────────────────
function summarize(runs) {
  const totalRuns = runs.length;
  let totalLift = 0;
  let totalRetained = 0;
  let totalRejected = 0;
  let totalTokens = 0;
  let liftCount = 0;
  for (const r of runs) {
    if (typeof r.lift === "number" && !Number.isNaN(r.lift)) {
      totalLift += r.lift;
      liftCount += 1;
    }
    totalRetained += r.retained || 0;
    totalRejected += r.rejected || 0;
    totalTokens += r.tokensUsed || 0;
  }
  return {
    totalRuns,
    totalLift: Number(totalLift.toFixed(6)),
    totalRetained,
    totalRejected,
    avgTokensPerRun: totalRuns > 0 ? Math.round(totalTokens / totalRuns) : 0,
  };
}

// ── 趋势表（ASCII）→ reports/metrics-trend.md ──────────────────────────────
function renderTrendTable(runs) {
  const lines = [];
  lines.push("# metrics-trend");
  lines.push("");
  lines.push("> 由 `scripts/metrics.mjs` 自动生成。聚合 `reports/evolution-run-*.md`。");
  lines.push("");
  if (runs.length === 0) {
    lines.push("no runs");
    lines.push("");
    return lines.join("\n");
  }
  // 列宽计算
  const header = ["report", "lift", "retained", "rejected", "tokens", "decision"];
  const rows = runs.map((r) => [
    r.report,
    r.lift === null ? "null" : String(r.lift),
    String(r.retained),
    String(r.rejected),
    String(r.tokensUsed),
    r.decision,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const fmt = (cells) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  const sep =
    "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";
  lines.push(fmt(header));
  lines.push(sep);
  for (const row of rows) lines.push(fmt(row));
  lines.push("");
  return lines.join("\n");
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(argv.slice(2));
  const runs = collectRuns(opts.reports);
  const summary = summarize(runs);
  const metrics = { runs, summary };

  writeFileSync(opts.out, JSON.stringify(metrics, null, 2) + "\n", "utf8");

  const trendPath = join(opts.reports, "metrics-trend.md");
  writeFileSync(trendPath, renderTrendTable(runs), "utf8");

  // stdout 打印趋势表（人类可读）+ 落盘提示。
  process.stdout.write(renderTrendTable(runs));
  process.stdout.write(`\nmetrics.json → ${opts.out}\n`);
  process.stdout.write(`metrics-trend.md → ${trendPath}\n`);

  // 兜底：CI 不红是底线——任何解析异常已在 collectRuns 内 warn 吞掉。
  exit(0);
}

main();
