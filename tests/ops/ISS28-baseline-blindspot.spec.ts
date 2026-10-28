// ISS-28 隐藏盲点：ID 集合门看不见「基线生成时被 skip、CI 上会跑」的用例。
//
// 现状（scripts/lib/test-baseline.mjs）：门只校验 passed.json 里的用例。
// 基线生成时被 skip 的用例（如 T04a 网络隔离：嵌套沙箱无 loopback）不在任何集合里，
// 若它们在 CI 上失败 → 门静默通过。这把「CI 从不执行真实路径」变成了不可见的回归。
//
// 本测试锁定修复后的行为（全部通过真实进程 + 退出码断言，不 mock）：
//   1. baseline 记 skip、本次 failed  → exit 1（回归必须红）
//   2. baseline 记 skip、本次 passed  → exit 0 + warn 提示更新基线
//   3. baseline 记 passed、本次 failed → exit 1（保留原回归语义）
//   4. 向后兼容：baseline 目录只有 passed.json（无 skipped.json）→ 照常工作
//
// RED state（本测试先于实现落地）：脚本不认识 `--from-json` / `--baseline-dir`
//   → 直接跑整套 vitest → 断言（退出码 / stderr 内容）不成立 → 红。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GATE = fileURLToPath(
  new URL("../../scripts/lib/test-baseline.mjs", import.meta.url),
);

const SPEC_REL = "/repo/tests/ops/ISS28-blindspot-sample.spec.ts";
const SKIPPED_ID = "tests/ops/ISS28-blindspot-sample.spec.ts > t04a-style loopback case";
const PASSED_ID = "tests/ops/ISS28-blindspot-sample.spec.ts > already covered case";

/** vitest `--reporter=json` 形状的最小摘要（normalizeTestId 需 name 含 `/tests/`）。 */
function vitestSummary(cases: { fullName: string; status: string }[]) {
  return {
    numTotalTests: cases.length,
    testResults: [
      {
        name: SPEC_REL,
        assertionResults: cases.map((c) => ({
          fullName: c.fullName,
          status: c.status,
          title: c.fullName,
        })),
      },
    ],
  };
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGate(baselineDir: string, summary: unknown): RunResult {
  const summaryPath = join(baselineDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary), "utf8");
  const r = spawnSync(
    process.execPath,
    [GATE, "--from-json", summaryPath, "--baseline-dir", baselineDir],
    { encoding: "utf8", timeout: 60_000 },
  );
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("ISS-28 · baseline gate blindspot (skipped-at-baseline tests)", () => {
  let baselineDir: string;

  beforeEach(() => {
    baselineDir = mkdtempSync(join(tmpdir(), "iss28-baseline-"));
    mkdirSync(baselineDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baselineDir, { recursive: true, force: true });
  });

  function writeBaseline(passed: string[], skipped?: string[]): void {
    writeFileSync(join(baselineDir, "passed.json"), JSON.stringify(passed), "utf8");
    if (skipped) {
      writeFileSync(
        join(baselineDir, "skipped.json"),
        JSON.stringify(skipped),
        "utf8",
      );
    }
  }

  it("baseline recorded as skipped, now FAILED → gate exits 1", () => {
    writeBaseline([], [SKIPPED_ID]);
    const r = runGate(
      baselineDir,
      vitestSummary([{ fullName: SKIPPED_ID.split(" > ")[1], status: "failed" }]),
    );
    expect(r.status).toBe(1);
    // 失败原因须点名该用例（否则 CI 日志无法定位）
    expect(r.stderr).toContain("t04a-style loopback case");
  });

  it("baseline recorded as skipped, now PASSED → gate exits 0 but warns to update", () => {
    writeBaseline([], [SKIPPED_ID]);
    const r = runGate(
      baselineDir,
      vitestSummary([{ fullName: SKIPPED_ID.split(" > ")[1], status: "passed" }]),
    );
    expect(r.status).toBe(0);
    const output = `${r.stdout}${r.stderr}`;
    expect(output).toMatch(/update|not in baseline|baseline/i);
  });

  it("baseline recorded as passed, now FAILED → gate still exits 1 (existing semantics kept)", () => {
    writeBaseline([PASSED_ID], []);
    const r = runGate(
      baselineDir,
      vitestSummary([{ fullName: PASSED_ID.split(" > ")[1], status: "failed" }]),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("already covered case");
  });

  it("NEW test (not in any baseline) now FAILED → gate exits 1 (no silent new breakage)", () => {
    // 新测试不在 passed.json 也不在 skipped.json——旧逻辑会静默放过。
    // ISS-28 诚实性：任何失败用例都必须让门禁红，否则新坏的测试不可见。
    writeBaseline([], []);
    const r = runGate(
      baselineDir,
      vitestSummary([{ fullName: "brand-new-broken-case", status: "failed" }]),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("brand-new-broken-case");
  });

  it("backward compatible: passed.json only (no skipped.json) → gate exits 0", () => {
    writeBaseline([PASSED_ID]);
    const r = runGate(
      baselineDir,
      vitestSummary([{ fullName: PASSED_ID.split(" > ")[1], status: "passed" }]),
    );
    expect(r.status).toBe(0);
  });
});
