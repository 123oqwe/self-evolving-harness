// ISS-02 步骤③④: 敏感性守卫 + 阴性对照（纯函数）单测。
//
// 因果性地基：杜绝「候选与 baseline 产出相同 VerifierRun 却仍 accept」的假信号，
// 并证明代理任务集对基质退化有区分力。
import { describe, it, expect } from "vitest";
import {
  detectSubstrateInsensitivity,
  assertSubstrateSensitive,
  SubstrateInsensitiveError,
  breakCompactionPrompt,
  resolveRateFromRuns,
  checkNegativeControl,
  assertNegativeControl,
  NegativeControlInvalidError,
  toResultVector,
  resultVectorsIdentical,
  checkCompactionPromptStructure,
  type VerifierRun,
} from "@harness/canary-eval";

// ── fixture 构造 ────────────────────────────────────────────────────────────

function mkRun(
  taskId: string,
  exitCode: number,
  opts: { stdout?: string; stderr?: string } = {},
): VerifierRun {
  return {
    taskId,
    command: `node scripts/check-compaction-proxy.mjs --check x`,
    exitCode,
    stdout: opts.stdout ?? `out:${taskId}:${exitCode}`,
    stderr: opts.stderr ?? "",
    runId: `run-${taskId}-${exitCode}`,
    contiguousRun: true,
    epermHits: [],
  };
}

// 与 L1-T02 baseline 同构的最小 compaction prompt（供 ③④ 破坏/检查）。
const PROMPT = [
  "## Goal",
  "Summarize progress.",
  "## Constraints",
  "- (none)",
  "## Progress",
  "### Done",
  "- [x] a",
  "### In Progress",
  "- [ ] b",
  "### Blocked",
  "- Issue X blocks progress",
  "## Decisions",
  "- **D**: rationale",
  "## Next Steps",
  "1. next",
  "## Critical Context",
  "- ref",
  "<safety>",
  "Never omit unresolved bugs from the Progress section. Never drop tool_use_id pairing.",
  "</safety>",
  "Preserve exact file paths, function names, and error messages.",
].join("\n");

// ── ③ 敏感性守卫 ────────────────────────────────────────────────────────────

describe("ISS-02 · ③ detectSubstrateInsensitivity", () => {
  it("baseline 与所有候选结果向量全等 → insensitive=true", () => {
    const baseline = [mkRun("t1", 0), mkRun("t2", 0)];
    const candidates = [
      { id: "cand-a", runs: [mkRun("t1", 0), mkRun("t2", 0)] },
      { id: "cand-b", runs: [mkRun("t1", 0), mkRun("t2", 0)] },
    ];
    const v = detectSubstrateInsensitivity(baseline, candidates);
    expect(v.insensitive).toBe(true);
    expect(v.identicalCandidates).toBe(2);
    expect(v.totalCandidates).toBe(2);
    expect(v.reason).toMatch(/substrate-insensitive/i);
  });

  it("任一候选结果向量与 baseline 不同 → insensitive=false", () => {
    const baseline = [mkRun("t1", 0), mkRun("t2", 0)];
    const candidates = [
      { id: "cand-a", runs: [mkRun("t1", 0), mkRun("t2", 0)] },
      { id: "cand-b", runs: [mkRun("t1", 0), mkRun("t2", 1)] }, // t2 退化
    ];
    const v = detectSubstrateInsensitivity(baseline, candidates);
    expect(v.insensitive).toBe(false);
    expect(v.identicalCandidates).toBe(1);
  });

  it("无候选 → insensitive=false（不误判空集）", () => {
    const v = detectSubstrateInsensitivity([mkRun("t1", 0)], []);
    expect(v.insensitive).toBe(false);
  });

  it("assertSubstrateSensitive 判 insensitive 即 throw", () => {
    const baseline = [mkRun("t1", 0)];
    const candidates = [{ id: "cand-a", runs: [mkRun("t1", 0)] }];
    expect(() => assertSubstrateSensitive(baseline, candidates)).toThrow(
      SubstrateInsensitiveError,
    );
  });

  it("结果向量逐任务比对（runId 不同不影响，stdout 不同即不同）", () => {
    const a = toResultVector([mkRun("t1", 0, { stdout: "same" })]);
    const b = toResultVector([mkRun("t1", 0, { stdout: "diff" })]);
    expect(resultVectorsIdentical(a, b)).toBe(false);
    expect(resultVectorsIdentical(a, a)).toBe(true);
  });
});

// ── ④ 阴性对照 ──────────────────────────────────────────────────────────────

describe("ISS-02 · ④ negative control + breakCompactionPrompt", () => {
  it("breakCompactionPrompt 删掉 Blocked 段", () => {
    const broken = breakCompactionPrompt(PROMPT, "remove-blocked");
    expect(broken).not.toContain("### Blocked");
    expect(broken).not.toContain("Issue X blocks progress");
    // 其它结构仍在
    expect(broken).toContain("## Progress");
    expect(broken).toContain("### Done");
    expect(broken).toContain("<safety>");
  });

  it("删除 Blocked 段后结构检查 blocked-not-merged 判 fail", () => {
    const before = checkCompactionPromptStructure(PROMPT, ["blocked-not-merged"]);
    expect(before.ok).toBe(true);
    const broken = breakCompactionPrompt(PROMPT, "remove-blocked");
    const after = checkCompactionPromptStructure(broken, ["blocked-not-merged"]);
    expect(after.ok).toBe(false);
    expect(after.violations.join(" ")).toMatch(/Blocked/);
  });

  it("checkNegativeControl: 破坏候选得分 < baseline → valid", () => {
    const baseline = [mkRun("t1", 0), mkRun("t2", 0)]; // resolve_rate 1.0
    const broken = [mkRun("t1", 0), mkRun("t2", 1)]; // resolve_rate 0.5
    const v = checkNegativeControl(baseline, broken);
    expect(v.valid).toBe(true);
    expect(v.baselineScore).toBe(1);
    expect(v.brokenScore).toBe(0.5);
    expect(resolveRateFromRuns(broken)).toBe(0.5);
  });

  it("checkNegativeControl: 破坏候选得分 >= baseline → invalid（任务集无区分力）", () => {
    const baseline = [mkRun("t1", 0), mkRun("t2", 0)];
    const v = checkNegativeControl(baseline, baseline);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/cannot discriminate/i);
  });

  it("assertNegativeControl invalid 即 throw", () => {
    const runs = [mkRun("t1", 0)];
    expect(() => assertNegativeControl(runs, runs)).toThrow(
      NegativeControlInvalidError,
    );
  });
});
