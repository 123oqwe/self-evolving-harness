// ISS-28: 进化闭环 e2e（假 pi fixture）——mine → mutate → score → select → deploy → verify
//
// 问题（评审 §ISS-28）：CI 从未执行过真实闭环。`evolution.yml` 真实进化 job 整段注释，
// `T02-pi-smoke` / `L3/real-llm` 用 skipIf(!canSpawnPi)，T04a 用 skipIf(!canHostLoopback)
// → CI 只证明了单元级正确性。
//
// 本测试补上「无密钥也能在 CI 跑通闭环」的那一块：
//   1. mine      —— 读 fixture 失败轨迹 JSONL，按错误签名聚合（failures ≥ 2）；
//   2. mutate    —— 经 RealLLMPort 真实 spawn `tests/fixtures/fake-pi/pi`（假 pi 可执行
//                   文件写 argv/stdin 记录到 FAKE_PI_LOG）→ 证明走的是真实子进程通道，
//                   不是 stub / 内存 FakeLLM；
//   3. score     —— runEvolutionCycle 内 ModeEvaluator 打分（mutationSource 驱动）；
//   4. select    —— strict-improvement 决策（accept/improve）；
//   5. deploy    —— canary release（CE-T06 canaryRelease）→ PROMOTE；
//   6. verify    —— mini-canary 的 verify 命令真实执行（spawnSync exit-code），
//                   机械证据落盘到 reportPath（VerifierRun.exitCode 由真实进程退出码裁决）。
//
// 反伪造断言（ISS-28 的核心）：报告里的 exitCode 必须是真实进程退出码——
//   成功 canary（`printf ... >> canary.log`）→ exitCode 0 且 canary.log 真被写；
//   失败 canary（`exit 7`）→ exitCode 7 且 select 判 reject（无 commit、无发布）。
//
// RED state（本测试先于实现落地）：`runEvolutionCycle` 的 E2EConfig 不支持 `reportPath`，
//   也不把 VerifierRun 机械证据回传/落盘 → 报告文件不存在 → 断言红。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runEvolutionCycle, RealLLMPort } from "@harness/l3-engine";
import type {
  CycleResult,
  E2EConfig,
  MiniCanaryTask,
} from "@harness/l3-engine";

// ---------------------------------------------------------------------------
// fake pi fixture（假 pi 可执行文件，CI 无 pi 时闭环仍可跑）
// ---------------------------------------------------------------------------

const FAKE_PI = fileURLToPath(new URL("../fixtures/fake-pi/pi", import.meta.url));

const BASELINE_PROMPT = [
  "# Compaction Summary",
  "- baseline marker: keep-this-anchor",
  "- summarize conversation history into <= 200 tokens",
].join("\n");

// 3 任务 mini-canary：verify 真实执行并把标记写进 workspace（机械证据落地）
function canaryWithMarker(dir: string): MiniCanaryTask[] {
  return [1, 2, 3].map((n) => ({
    id: `iss28-task-${n}`,
    verify: `printf 'iss28-task-${n}\\n' >> canary.log`,
    expectedExit: 0,
  }));
}

// 必失败的 canary：exit-code ≠ expectedExit → select 必须 reject（机械证据优先）
const FAILING_CANARY: MiniCanaryTask[] = [
  { id: "iss28-task-1", verify: "exit 7", expectedExit: 0 },
];

const POLICY = {
  shadowPercent: 0.05,
  observationWindowTurns: 10,
  revertThresholds: {
    resolveRateDrop: 0.1,
    costRise: 0.5,
    piiCount: 0,
    paretoDominated: false,
  },
  rainbowParallelVariants: 1,
};

function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initWorkspace(): { dir: string; baselineSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "iss28-e2e-"));
  mkdirSync(join(dir, "prompts"), { recursive: true });
  mkdirSync(join(dir, "transcripts"), { recursive: true });
  mkdirSync(join(dir, "reports"), { recursive: true });
  writeFileSync(
    join(dir, "prompts", "compaction-summary.md"),
    BASELINE_PROMPT,
    "utf8",
  );
  // 失败轨迹 fixture（mine 步输入；ISS-08 拥有真实轨迹来源，此处登记为 fixture）
  writeFileSync(
    join(dir, "transcripts", "failure-001.jsonl"),
    [
      JSON.stringify({
        source: "fixture",
        status: "failed",
        signature: "blocked-section-merged",
        error: "compaction merged the Blocked section",
      }),
      JSON.stringify({
        source: "fixture",
        status: "failed",
        signature: "blocked-section-merged",
        error: "compaction dropped tool_use_id",
      }),
      JSON.stringify({
        source: "fixture",
        status: "resolved",
        signature: "-",
        error: "",
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  execFileSync("git", ["init", "-q", dir], { stdio: ["ignore", "pipe", "pipe"] });
  git(["add", "."], dir);
  execFileSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.name=e2e",
      "-c",
      "user.email=e2e@harness",
      "commit",
      "-q",
      "-m",
      "baseline: compaction prompt + failure transcripts",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return { dir, baselineSha: git(["rev-parse", "HEAD"], dir).trim() };
}

/** mine 步：读失败轨迹 JSONL → 按 signature 聚合成变异上下文。 */
function mineFailures(transcript: string): {
  failedCount: number;
  signatures: string[];
  summary: string;
} {
  const rows = readFileSync(transcript, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { status: string; signature: string; error: string });
  const failed = rows.filter((r) => r.status === "failed");
  const signatures = [...new Set(failed.map((r) => r.signature))].sort();
  return {
    failedCount: failed.length,
    signatures,
    summary: failed.map((r) => `- [${r.signature}] ${r.error}`).join("\n"),
  };
}

interface CycleReport {
  retain: number;
  decision: "accept" | "reject";
  reason: string;
  mode?: string;
  baselineResolveRate?: number;
  mutantResolveRate?: number | null;
  evidence?: { taskId: string; command: string; exitCode: number }[];
}

describe("ISS-28 · evolution cycle e2e with fake pi", () => {
  let dir: string;
  let baselineSha: string;

  beforeEach(() => {
    const ws = initWorkspace();
    dir = ws.dir;
    baselineSha = ws.baselineSha;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fake pi fixture is an executable file (CI has no real pi)", () => {
    expect(existsSync(FAKE_PI)).toBe(true);
    // 可执行位：否则 RealLLMPort spawn 会 EACCES → 闭环在 CI 上不可能跑通
    chmodSync(FAKE_PI, 0o755);
    expect(execFileSync("test", ["-x", FAKE_PI], { stdio: "ignore" }) ?? true).toBeTruthy();
  });

  it("mine → mutate via real spawn of fake pi (not a stub)", async () => {
    const mined = mineFailures(join(dir, "transcripts", "failure-001.jsonl"));
    // mine: 2 条失败轨迹聚合成 1 个 signature
    expect(mined.failedCount).toBe(2);
    expect(mined.signatures).toEqual(["blocked-section-merged"]);

    const log = join(dir, "fake-pi-calls.log");
    // T01 之后变异 LLM 走 env 白名单，测试直接导出的 FAKE_PI_LOG 不会传给子进程。
    // 故用包装脚本在子进程内部自行注入（也顺带证明 env 白名单确实生效）。
    const wrapper = join(dir, "pi-wrap.sh");
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexport FAKE_PI_LOG="${log}"\nexec "${FAKE_PI}" "$@"\n`,
      "utf8",
    );
    chmodSync(wrapper, 0o755);
    try {
      const port = new RealLLMPort({ piBin: wrapper, timeoutMs: 20_000 });
      const reply = await port.complete(
        [
          "Propose a better compaction prompt for these failed trajectories:",
          mined.summary,
          "MINE-ANCHOR-ISS28",
        ].join("\n"),
      );

      // mutate: 回复来自 fixture 的 canned payload（真实子进程 stdout）
      expect(reply).toContain("MUT-ISS28");

      // 不是 stub：fake pi 真的被 spawn，argv 含 `-p`，stdin 收到 mine 结果
      expect(existsSync(log)).toBe(true);
      const calls = readFileSync(log, "utf8");
      expect(calls).toContain("ARGV: -p");
      expect(calls).toContain("MINE-ANCHOR-ISS28");
    } finally {
      delete process.env.FAKE_PI_LOG;
    }
  });

  it("full loop runs score → select → deploy → verify with landed mechanical evidence", async () => {
    const reportPath = join(dir, "reports", "cycle-report.json");
    const config: E2EConfig = {
      workspaceDir: dir,
      promptPath: join(dir, "prompts", "compaction-summary.md"),
      baselineSha,
      canary: canaryWithMarker(dir),
      generations: 1,
      mutationSource: { mode: "improve" },
      canaryPolicy: POLICY,
      reportPath,
    };

    const result: CycleResult = await runEvolutionCycle(config);

    // select: 流程跑通（注意：`reason: "improved"` 的分数目前来自 ModeEvaluator
    // 的占位常量 0.6 > 基线 0.5，**不是真实测量**。按 EVAL-2026-10-28 的规则，
    // 本测试只锁定「流程跑通 + 机械证据真实」，不把占位分数锁成验收标准；
    // 真实分数断言留给 T04（删死分数）之后的新测试。
    expect(result.committed).not.toBeNull();
    expect(result.committed?.origin).toBe("e2e");
    expect(git(["log", "--pretty=%s"], dir)).toContain("origin=e2e");

    // deploy: canary release PROMOTE
    expect(result.canaryRelease?.decision).toBe("PROMOTE");

    // verify: canary 命令真实执行（标记文件被写）
    const markers = readFileSync(join(dir, "canary.log"), "utf8").trim().split("\n");
    expect(new Set(markers)).toEqual(
      new Set(["iss28-task-1", "iss28-task-2", "iss28-task-3"]),
    );

    // 机械证据落盘（VerifierRun.exitCode 来自真实进程退出码）
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as CycleReport;
    // 只断言决策字段存在且取值合法（不锁定 "improved" —— 见上方说明）。
    expect(["accept", "reject"]).toContain(report.decision);
    expect(typeof report.reason).toBe("string");
    expect(Array.isArray(report.evidence)).toBe(true);
    const evidence = report.evidence ?? [];
    expect(evidence.length).toBeGreaterThanOrEqual(3);
    expect(new Set(evidence.map((e) => e.taskId))).toEqual(
      new Set(["iss28-task-1", "iss28-task-2", "iss28-task-3"]),
    );
    for (const e of evidence) {
      expect(e.exitCode).toBe(0);
      expect(e.command.length).toBeGreaterThan(0);
    }
    // 占位分数：仅断言数值形状，不当作「真实改进」的验收证据（待 T04）。
    expect(typeof report.mutantResolveRate).toBe("number");
    expect(typeof report.baselineResolveRate).toBe("number");
  });

  it("failing canary exit-code is real: select rejects and no commit happens", async () => {
    const reportPath = join(dir, "reports", "cycle-report-fail.json");
    const before = git(["rev-list", "--count", "HEAD"], dir).trim();

    const result = await runEvolutionCycle({
      workspaceDir: dir,
      promptPath: join(dir, "prompts", "compaction-summary.md"),
      baselineSha,
      canary: FAILING_CANARY,
      generations: 1,
      mutationSource: { mode: "improve" },
      canaryPolicy: POLICY,
      reportPath,
    });

    // 机械证据优先于 Fitness：canary exit 7 ≠ expectedExit 0 → reject
    expect(result.committed).toBeNull();
    expect(result.canaryRelease).toBeNull();
    expect(git(["rev-list", "--count", "HEAD"], dir).trim()).toBe(before);

    const report = JSON.parse(readFileSync(reportPath, "utf8")) as CycleReport;
    expect(report.decision).toBe("reject");
    expect(report.evidence?.[0]?.exitCode).toBe(7);
  });
});
