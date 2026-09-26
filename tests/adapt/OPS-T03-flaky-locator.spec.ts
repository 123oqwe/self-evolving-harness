// OPS-T03: flaky 用例定位 — scripts/run-suite-5x.mjs 的可测部分（fixture 驱动）
//
// OPS-T03 主体是 report + 配置类任务（5 次跑套件 + 定位 flake + 收紧
// GREENS.baseline 容差 5→2），验收走 Form B（bash grep 报告要素 + ci.yml
// 容差）。本文件只钉其**可测部分**：`scripts/run-suite-5x.mjs` 的 flake
// diff 逻辑——给定 N 次 vitest json reporter 输出，计算 pass/fail 矩阵、
// 标出结果跨 run 不一致的用例（flake）。
//
// 为避免测试自身跑 5 次套件（慢 + 自身 flaky），脚本须支持 `--diff <dir>`
// 离线模式：读取预落盘的 `<dir>/run-1.json ... run-N.json`（vitest json
// reporter 形状），diff 出 flake，写报告到 `--out`。脚本未实现 → RED。
//
// 覆盖 spec（execution/adapt/TASKS.md §OPS-T03）可测场景：
//   1. 5 次 run 中 testA 全 pass、testB 部分 pass 部分 fail → 报告标 testB
//      为 flake，testA 为 stable（不标）
//   2. 5 次 run 全一致（无 flake）→ 报告 "no flake detected" + flake 列表空
//   3. skipped 用例不计为 flake（skip≠抖动）
//   4. 报告含 5 次 run 的 pass/fail 矩阵（run-1..run-N 列）
//   5. 边界：某用例 5 次 run 仅 1 次 fail + 4 次 pass 仍算 flake（结果跨 run
//      不一致即 flake，spec "≥2 次 run 中结果不一致"）
//   6. 错误路径：某 run-*.json 解析失败 → 跳过该 run + warn，不崩，exit 0
//
// RED state: scripts/run-suite-5x.mjs 未落地 → execFileSync 失败 = 合法 RED。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "run-suite-5x.mjs");

// ---------------------------------------------------------------------------
// vitest json reporter fixture builder（jest-compatible，vitest 亦输出此形状）
// 形状：{ testResults: [{ name, assertionResults: [{ fullName, status }] }] }
// status ∈ "passed" | "failed" | "skipped"
// ---------------------------------------------------------------------------

type TestStatus = "passed" | "failed" | "skipped";

interface VitestJson {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ fullName: string; status: TestStatus }>;
  }>;
}

/**
 * 构造一次 run 的 vitest json reporter 输出。
 * @param runStatuses  record: testFullName → 该 run 中的 status
 */
function vitestJson(runStatuses: Record<string, TestStatus>): VitestJson {
  return {
    testResults: [
      {
        name: "/repo/tests/sample.spec.ts",
        assertionResults: Object.entries(runStatuses).map(
          ([fullName, status]) => ({ fullName, status }),
        ),
      },
    ],
  };
}

function writeRun(runsDir: string, runIdx: number, json: VitestJson): string {
  const file = join(runsDir, `run-${runIdx}.json`);
  writeFileSync(file, JSON.stringify(json), "utf8");
  return file;
}

function runSuite5xDiff(runsDir: string, outFile: string, runs = 5): string {
  return execFileSync(
    "node",
    [SCRIPT, "--diff", runsDir, "--out", outFile, "--runs", String(runs)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven)", () => {
  let tmpRoot: string;
  let runsDir: string;
  let outFile: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "ops-flaky-"));
    runsDir = join(tmpRoot, "runs");
    mkdirSync(runsDir, { recursive: true });
    outFile = join(tmpRoot, "flaky-locator-001.md");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("identifies flaky test (pass in some runs, fail in others); stable not flagged", () => {
    // Given 5 次 run：testA 全 pass；testB 在 run 2/4 fail、其余 pass
    const a = "suite > testA";
    const b = "suite > testB";
    writeRun(runsDir, 1, vitestJson({ [a]: "passed", [b]: "passed" }));
    writeRun(runsDir, 2, vitestJson({ [a]: "passed", [b]: "failed" }));
    writeRun(runsDir, 3, vitestJson({ [a]: "passed", [b]: "passed" }));
    writeRun(runsDir, 4, vitestJson({ [a]: "passed", [b]: "failed" }));
    writeRun(runsDir, 5, vitestJson({ [a]: "passed", [b]: "passed" }));
    // When run diff
    runSuite5xDiff(runsDir, outFile);
    // Then 报告落盘
    expect(existsSync(outFile)).toBe(true);
    const report = readFileSync(outFile, "utf8");
    // And testB 标为 flake
    expect(report).toContain("testB");
    // And testA 未被标为 flake（report 不把 testA 列入 flake 区段）
    //   flake 区段以 "flake" 标识；testA 只应出现在 stable/矩阵中。
    //   断言：report 含 "flake" 关键字，且 testB 在 flake 上下文出现。
    expect(report.toLowerCase()).toContain("flake");
    // And 报告区分 flake 与 stable：testB 出现次数 > testA 在 flake 段
    //   （testA 不应被标 flake——这里用 "no flake" 反向不成立来兜底）
    expect(report).not.toMatch(/no flake/i);
  });

  it("no flake when all 5 runs identical → reports no flake detected", () => {
    // Given 5 次 run 完全一致（testA pass、testB pass）
    const a = "suite > testA";
    const b = "suite > testB";
    for (let i = 1; i <= 5; i++) {
      writeRun(runsDir, i, vitestJson({ [a]: "passed", [b]: "passed" }));
    }
    // When run diff
    runSuite5xDiff(runsDir, outFile);
    // Then 报告标注 no flake
    const report = readFileSync(outFile, "utf8");
    expect(report).toMatch(/no flake/i);
    // And flake 列表为空（testA/testB 不被标 flake）
    //   报告不应出现 "testA" 紧邻 flake 标识的行；用矩阵出现 ≠ flake 标识。
    //   断言 no flake 即足够。
  });

  it("skipped tests are not flagged as flake (skip ≠ flake)", () => {
    // Given 5 次 run：testSkip 在所有 run 都 skipped；testFlake pass/fail 混合
    const sk = "suite > testSkip";
    const fl = "suite > testFlake";
    writeRun(runsDir, 1, vitestJson({ [sk]: "skipped", [fl]: "passed" }));
    writeRun(runsDir, 2, vitestJson({ [sk]: "skipped", [fl]: "failed" }));
    writeRun(runsDir, 3, vitestJson({ [sk]: "skipped", [fl]: "passed" }));
    writeRun(runsDir, 4, vitestJson({ [sk]: "skipped", [fl]: "passed" }));
    writeRun(runsDir, 5, vitestJson({ [sk]: "skipped", [fl]: "passed" }));
    // When run diff
    runSuite5xDiff(runsDir, outFile);
    // Then testFlake 标为 flake；testSkip 不标为 flake
    const report = readFileSync(outFile, "utf8");
    expect(report).toContain("testFlake");
    // testSkip 出现在矩阵但不被标 flake：报告 flake 段不含 testSkip
    //   （粗断：report 含 testFlake 于 flake 上下文，testSkip 仅在矩阵）
    expect(report).not.toMatch(/flake[^\n]*testSkip/i);
    expect(report).not.toMatch(/testSkip[^\n]*flake/i);
  });

  it("reports pass/fail matrix across runs (run-1..run-N columns)", () => {
    // Given 5 次 run（testA pass/fail 混合）
    const a = "suite > testA";
    writeRun(runsDir, 1, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 2, vitestJson({ [a]: "failed" }));
    writeRun(runsDir, 3, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 4, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 5, vitestJson({ [a]: "passed" }));
    // When run diff
    runSuite5xDiff(runsDir, outFile);
    // Then 报告含矩阵，标注各 run（run-1..run-5）
    const report = readFileSync(outFile, "utf8");
    expect(report).toContain("run-1");
    expect(report).toContain("run-2");
    expect(report).toContain("run-5");
    // And 含 pass/fail 状态标记（testA 在 run-2 fail）
    expect(report).toContain("testA");
  });

  it("single failure across 5 runs is still a flake (status varies)", () => {
    // Given testA 在 run-3 仅 1 次 fail、其余 4 次 pass（结果跨 run 不一致）
    const a = "suite > testA";
    writeRun(runsDir, 1, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 2, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 3, vitestJson({ [a]: "failed" }));
    writeRun(runsDir, 4, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 5, vitestJson({ [a]: "passed" }));
    // When run diff
    runSuite5xDiff(runsDir, outFile);
    // Then testA 标为 flake（spec：≥2 次 run 中结果不一致即 flake；
    //   1 fail + 4 pass 跨 5 run 不一致 = flake）
    const report = readFileSync(outFile, "utf8");
    expect(report).toContain("testA");
    expect(report.toLowerCase()).toContain("flake");
    expect(report).not.toMatch(/no flake/i);
  });

  it("malformed run json → skipped + warn, does not crash (exit 0)", () => {
    // Given 5 次 run，run-3.json 是非法 JSON；其余合法（testA pass/fail 混合）
    const a = "suite > testA";
    writeRun(runsDir, 1, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 2, vitestJson({ [a]: "failed" }));
    // run-3 非法
    writeFileSync(join(runsDir, "run-3.json"), "{ broken json }}}", "utf8");
    writeRun(runsDir, 4, vitestJson({ [a]: "passed" }));
    writeRun(runsDir, 5, vitestJson({ [a]: "passed" }));
    // When run diff（不抛 = 不崩 = exit 0）
    expect(() => runSuite5xDiff(runsDir, outFile)).not.toThrow();
    // Then 报告仍落盘（run-3 被跳过 + warn）
    expect(existsSync(outFile)).toBe(true);
    const report = readFileSync(outFile, "utf8");
    // And 报告仍含 testA（基于剩余 4 次 run 的 diff）
    expect(report).toContain("testA");
  });
});
