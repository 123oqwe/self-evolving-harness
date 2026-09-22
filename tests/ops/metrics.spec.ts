// OPS-T02: metrics 聚合 — scripts/metrics.mjs markdown 解析 + 聚合 + 趋势表
//
// 覆盖 spec（execution/adapt/TASKS.md §OPS-T02）的 Given/When/Then 全部场景：
//   1. reports/ 含 evolution-run 报告 → metrics.json 含 run + summary.totalLift
//   2. 空 reports/ → metrics.json runs:[] + exit 0
//   3. reject 报告（无 lift）→ lift:null + decision:reject + 不计入 totalLift
//   4. 报告 markdown 解析失败 → 该 run 跳过 + warn，不崩
//   5. 趋势表 reports/metrics-trend.md 落盘
//
// RED state: scripts/metrics.mjs 未实现 → spawn 失败 = 合法 RED。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..", "..");

function runMetrics(reportsDir: string, outFile: string) {
  return execFileSync(
    "node",
    [join(REPO_ROOT, "scripts", "metrics.mjs"), "--reports", reportsDir, "--out", outFile],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function evolutionReport(opts: {
  lift?: number;
  retained?: number;
  rejected?: number;
  tokens?: number;
  decision: "accept" | "reject";
}): string {
  const liftLine =
    opts.decision === "accept" && opts.lift !== undefined
      ? `lift: ${opts.lift}`
      : "lift: n/a (reject)";
  return [
    "# evolution-run-001.md",
    "",
    "## baseline",
    "baseline sha: abc123",
    "",
    "## mine",
    "read failed trajectories.",
    "",
    "## mutate",
    "RealLLMPort produced mutation candidates.",
    "",
    "## score",
    "scored candidates on canary tasks.",
    "",
    "## select",
    "StrictImprovementGate decision.",
    "",
    "## deploy",
    `deploy ${opts.decision}.`,
    "",
    "## verify",
    "regression canary run.",
    "",
    "## 结论",
    `${liftLine}`,
    `retained: ${opts.retained ?? 0}`,
    `rejected: ${opts.rejected ?? 0}`,
    `tokens: ${opts.tokens ?? 0}`,
    `decision: ${opts.decision}`,
    "",
    "CE-TASK-0001 pass",
    "CE-TASK-0002 pass",
    "CE-TASK-0003 pass",
  ].join("\n");
}

describe("OPS-T02 · metrics aggregation", () => {
  let tmpRoot: string;
  let reportsDir: string;
  let outFile: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "ops-metrics-"));
    reportsDir = join(tmpRoot, "reports");
    mkdirSync(reportsDir, { recursive: true });
    outFile = join(tmpRoot, "metrics.json");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("aggregates lift/retained/rejected/tokens/decision + summary.totalLift", () => {
    // Given reports/ 含 evolution-run-001.md（accept, lift:0.03, retained:1, tokens:12000）
    writeFileSync(
      join(reportsDir, "evolution-run-001.md"),
      evolutionReport({ lift: 0.03, retained: 1, rejected: 0, tokens: 12000, decision: "accept" }),
      "utf8",
    );
    // When run metrics
    runMetrics(reportsDir, outFile);
    // Then metrics.json 含该 run + summary
    const m = JSON.parse(readFileSync(outFile, "utf8"));
    expect(Array.isArray(m.runs)).toBe(true);
    expect(m.runs.length).toBe(1);
    const run = m.runs[0];
    expect(run.report).toBe("evolution-run-001.md");
    expect(run.lift).toBeCloseTo(0.03, 5);
    expect(run.retained).toBe(1);
    expect(run.rejected).toBe(0);
    expect(run.tokensUsed).toBe(12000);
    expect(run.decision).toBe("accept");
    // And summary.totalLift = 0.03
    expect(m.summary.totalRuns).toBe(1);
    expect(m.summary.totalLift).toBeCloseTo(0.03, 5);
    expect(m.summary.totalRetained).toBe(1);
    expect(m.summary.avgTokensPerRun).toBe(12000);
  });

  it("empty reports → runs:[] + summary zero + exit 0", () => {
    // Given reports/ 为空（无 evolution-run 报告）
    // When run metrics
    runMetrics(reportsDir, outFile);
    // Then metrics.json runs:[] + summary zero
    const m = JSON.parse(readFileSync(outFile, "utf8"));
    expect(m.runs).toEqual([]);
    expect(m.summary.totalRuns).toBe(0);
    expect(m.summary.totalLift).toBe(0);
    // exit 0（runMetrics 不抛即 exit 0）
    expect(existsSync(outFile)).toBe(true);
  });

  it("reject report (no lift) → lift:null + decision:reject + excluded from totalLift", () => {
    // Given reject 报告（无 lift）+ 一条 accept 报告
    writeFileSync(
      join(reportsDir, "evolution-run-001.md"),
      evolutionReport({ retained: 0, rejected: 1, tokens: 5000, decision: "reject" }),
      "utf8",
    );
    writeFileSync(
      join(reportsDir, "evolution-run-002.md"),
      evolutionReport({ lift: 0.05, retained: 1, rejected: 0, tokens: 8000, decision: "accept" }),
      "utf8",
    );
    // When run metrics
    runMetrics(reportsDir, outFile);
    // Then reject run lift:null + decision:reject
    const m = JSON.parse(readFileSync(outFile, "utf8"));
    const rejectRun = m.runs.find((r: { report: string }) => r.report === "evolution-run-001.md");
    expect(rejectRun).toBeDefined();
    expect(rejectRun.lift).toBeNull();
    expect(rejectRun.decision).toBe("reject");
    // And totalLift 只计 accept run（0.05），不计 reject
    expect(m.summary.totalLift).toBeCloseTo(0.05, 5);
  });

  it("malformed report (no key fields) → skipped + warn, does not crash", () => {
    // Given 报告缺关键字段（无 lift/decision/tokens）
    writeFileSync(
      join(reportsDir, "evolution-run-001.md"),
      "# evolution-run-001.md\n\njust some prose, no metrics\n",
      "utf8",
    );
    // When run metrics（不抛 = 不崩）
    runMetrics(reportsDir, outFile);
    // Then 该 run 被跳过（runs:[] 或不含该报告）
    const m = JSON.parse(readFileSync(outFile, "utf8"));
    const hasIt = (m.runs as Array<{ report: string }>).some(
      (r) => r.report === "evolution-run-001.md",
    );
    expect(hasIt).toBe(false);
  });

  it("emits reports/metrics-trend.md trend table", () => {
    // Given reports/ 含一条 accept 报告
    writeFileSync(
      join(reportsDir, "evolution-run-001.md"),
      evolutionReport({ lift: 0.03, retained: 1, tokens: 12000, decision: "accept" }),
      "utf8",
    );
    // When run metrics
    runMetrics(reportsDir, outFile);
    // Then reports/metrics-trend.md 落盘
    const trend = join(reportsDir, "metrics-trend.md");
    expect(existsSync(trend)).toBe(true);
    const content = readFileSync(trend, "utf8");
    // And 趋势表含报告名
    expect(content).toContain("evolution-run-001.md");
  });
});
