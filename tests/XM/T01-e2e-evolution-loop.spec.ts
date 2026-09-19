// XM-T01: 跨模块 MVP 端到端验收 —— 进化闭环全链路 run + 回滚演练 + Gate G5 验收报告
//
// 覆盖 spec（execution/cross-module/TASKS.md §XM-T01）的 Given/When/Then 全部场景：
//   1. 正常路径：e2e-workspace（1 baseline compaction prompt + 3 任务 mini-canary + FakeLLM 变异源）
//      → runEvolutionCycle 跑 1 代 → ≥1 mutant 过 strict-improvement 门 → commit-on-success
//      → prompts/ git 历史含 origin=e2e 新 commit + canary release 记录存在。
//   2. 回滚演练：已发布 mutant 的 shadow canary 产生回归信号（fixture 注入）→ AutoRevert 触发
//      → git checkout（走 CE-T06 revertExec）后 baseline 在 mini-canary 上 resolve_rate 恢复 baseline 水平。
//   3. 边界（无进化）：优化器产出全部被 held-out 门拒绝（变异均降分）→ 1 代结束
//      → 无 commit、无发布、报告如实记录 retain=0。
//   4. 错误路径：G5 报告生成器输入不完整（缺 McNemar 输出）→ 抛 IncompleteG5Evidence 并列出缺失项。
//
// RED state: @harness/l3-engine（runEvolutionCycle 未导出）、@harness/canary-eval（包未链接）、
//   ../../scripts/xm/g5-report.ts（文件不存在）三者任一在 suite 加载期触发 module-resolution 失败
//   = 合法 RED。实现 GREEN 后下列断言须真正检验行为。
//
// 跨模块契约对齐：
//   - 引擎入口 runEvolutionCycle(config: E2EConfig): Promise<CycleResult> —— XM spec 指明借用 L3-T09。
//     注：L3-T09 spec 内部命名为 runEvolutionLoop/LoopResult，与本任务的 runEvolutionCycle/E2EConfig/
//     CycleResult 存在命名/形状差异（见文末 ambiguities）。本测试按 XM spec 命名锁定。
//   - canaryRelease / revertExec —— CE-T06 导出（revertExec 为 static-core 回滚本体，src/revert.ts）。
//   - ReleasePolicy / CanaryObservations / ReleaseEvent 形状对齐 CE-T06 接口签名。
//   - g5-report —— XM-T01 自研，落 scripts/xm/g5-report.ts，消费 CE-T08 McNemar + TL-T07 指标 + 回滚演练日志。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// —— 引擎入口（@harness/l3-engine）————————————————————————————————————————————
// runEvolutionCycle 为值导入（RED 触发点之一）；E2EConfig/CycleResult/MiniCanaryTask/MutationSource
// 为类型导入（描述 XM 编排契约，由 l3-engine 导出）。
import { runEvolutionCycle } from "@harness/l3-engine";
import type {
  E2EConfig,
  CycleResult,
  MiniCanaryTask,
  MutationSource,
} from "@harness/l3-engine";

// —— canary 发布 + 回滚本体（@harness/canary-eval，CE-T06）——————————————————————
// canaryRelease / revertExec 为值导入（RED 触发点：包未链接）。
import { canaryRelease, revertExec } from "@harness/canary-eval";
import type {
  ReleasePolicy,
  CanaryObservations,
  ReleaseEvent,
} from "@harness/canary-eval";

// —— G5 报告生成器（XM-T01 自研，落 scripts/xm/g5-report.ts）——————————————————————
// generateG5Report / IncompleteG5Evidence 为值导入（RED 触发点：文件不存在）。
import {
  generateG5Report,
  IncompleteG5Evidence,
} from "../../scripts/xm/g5-report.ts";
import type { G5Evidence } from "../../scripts/xm/g5-report.ts";

// ---------------------------------------------------------------------------
// 常量与辅助构造器
//
// 说明：spec 仅给出 runEvolutionCycle(config): Promise<CycleResult> 的函数签名与 4 条 GWT，
// 未给出 E2EConfig / CycleResult 的字段形状，也未给出 MutationSource / MiniCanaryTask 的形状。
// 此处按最小可工作假设锁定契约（见各字段注释），缺口见文末 ambiguities。
// ---------------------------------------------------------------------------

// baseline compaction prompt（被进化基质；落 prompts/compaction-summary.md）
const BASELINE_PROMPT = [
  "# Compaction Summary",
 "",
  "- baseline marker: keep-this-anchor",
  "- summarize conversation history into <= 200 tokens",
].join("\n");

// 3 任务 mini-canary（PRD §8.1 验收门软化：3 任务只验方向性，不做统计显著性）
const MINI_CANARY: MiniCanaryTask[] = [
  { id: "xm-task-1", verify: "exit 0", expectedExit: 0 },
  { id: "xm-task-2", verify: "exit 0", expectedExit: 0 },
  { id: "xm-task-3", verify: "exit 0", expectedExit: 0 },
];

// canary 发布策略（对齐 CE-T06 ReleasePolicy：shadow 5%，退化信号阈值）
const PROMOTE_POLICY: ReleasePolicy = {
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

// 正常观察窗口（无退化）→ canaryRelease 决策 PROMOTE
const GOOD_OBS: CanaryObservations = {
  resolveRate: 0.9,
  cost: 50,
  piiCount: 0,
  paretoDominated: false,
};

// 回归观察窗口（resolveRate 大幅下降 ≥ revertThresholds.resolveRateDrop）→ 触发 AUTO_REVERT
const REGRESSION_OBS: CanaryObservations = {
  resolveRate: 0.2, // 较 baseline 1.0 下降 0.8 >> 0.1 阈值
  cost: 50,
  piiCount: 0,
  paretoDominated: false,
};

// 在 cwd 内执行 git（统一注入 -C cwd）
function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// 初始化 e2e-workspace：建 prompts/compaction-summary.md + git init + 首次 commit = baseline
function initWorkspace(): { dir: string; baselineSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "xm-e2e-"));
  mkdirSync(join(dir, "prompts"), { recursive: true });
  writeFileSync(join(dir, "prompts", "compaction-summary.md"), BASELINE_PROMPT, "utf8");
  execFileSync("git", ["init", "-q", dir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  git(["add", "prompts/compaction-summary.md"], dir);
  execFileSync(
    "git",
    ["-C", dir, "-c", "user.name=e2e", "-c", "user.email=e2e@harness", "commit", "-q", "-m", "baseline: compaction prompt"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const baselineSha = git(["rev-parse", "HEAD"], dir).trim();
  return { dir, baselineSha };
}

// git rev-list --count HEAD（commit 总数）
function gitLogCount(cwd: string): number {
  return parseInt(git(["rev-list", "--count", "HEAD"], cwd).trim(), 10);
}

// git log --pretty=%s（commit 主题列表，用于断言 origin=e2e）
function gitLogMessages(cwd: string): string[] {
  return git(["log", "--pretty=%s"], cwd).trim().split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------
// XM-T01
// ---------------------------------------------------------------------------
describe("XM-T01", () => {
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

  // -------------------------------------------------------------------------
  // 场景 1（正常路径）+ RED 名: "e2e: full cycle produces committed mutant"
  //   Given e2e-workspace（baseline prompt + 3 mini-canary + FakeLLM 变异源 mode=improve）
  //   When  runEvolutionCycle 跑 1 代
  //   Then  ≥1 mutant 过 strict-improvement 门 + commit-on-success 后 git log 含 origin=e2e 新 commit
  //         + canary release 记录存在
  // -------------------------------------------------------------------------
  it("e2e: full cycle produces committed mutant", async () => {
    const config: E2EConfig = {
      workspaceDir: dir,
      promptPath: join(dir, "prompts", "compaction-summary.md"),
      baselineSha,
      canary: MINI_CANARY,
      generations: 1,
      mutationSource: { mode: "improve" } as MutationSource,
      canaryPolicy: PROMOTE_POLICY,
    };

    const baselineCommits = gitLogCount(dir);
    const result: CycleResult = await runEvolutionCycle(config);

    // (a) ≥1 mutant 过 strict-improvement 门
    expect(result.retainedMutants).toBeGreaterThanOrEqual(1);

    // (b) commit-on-success：committed mutant 携带 origin=e2e
    expect(result.committed).not.toBeNull();
    expect(result.committed?.origin).toBe("e2e");

    // (c) git 历史含新 commit（commit 数增加），且新 commit 主题含 origin=e2e
    expect(gitLogCount(dir)).toBeGreaterThan(baselineCommits);
    const msgs = gitLogMessages(dir);
    expect(msgs.some((m) => m.includes("origin=e2e"))).toBe(true);

    // (d) canary release 记录存在（正常路径 → PROMOTE）
    expect(result.canaryRelease).not.toBeNull();
    const release = result.canaryRelease as ReleaseEvent;
    expect(release.decision).toBe("PROMOTE");
    expect(release.variantSha).toBe(result.committed?.sha);

    // (e) 跨模块显式校验：用 CE-T06 canaryRelease 直接发布该 mutant → 同样 PROMOTE
    //     （证明 XM 编排借用的 CE-T06 入口真实可用，而非空壳）
    //     注：canaryRelease 签名对齐已锁定 CE-T06.spec.ts 的 5 参形态
    //     canaryRelease(variantSha, baselineSha, policy, observations, { baselineResolveRate })
    //     ——第 5 参 baselineResolveRate 为裁决 PROMOTE/AUTO_REVERT 所必需（resolveRate 降幅基准）。
    const direct = await canaryRelease(
      (result.committed as { sha: string }).sha,
      baselineSha,
      PROMOTE_POLICY,
      GOOD_OBS,
      { baselineResolveRate: 0.9 }, // GOOD_OBS.resolveRate=0.9 → 无降幅 → PROMOTE
    );
    expect(direct.decision).toBe("PROMOTE");
    expect(direct.variantSha).toBe((result.committed as { sha: string }).sha);
  });

  // -------------------------------------------------------------------------
  // 场景 2（回滚演练）+ RED 名: "e2e: regression signal triggers revert and restores baseline"
  //   Given 已发布 mutant 的 shadow canary 产生回归信号（fixture 注入 REGRESSION_OBS）
  //   When  AutoRevert 触发（走 CE-T06 revertExec，禁止测试内直接 git checkout）
  //   Then  git checkout 后 baseline 在 mini-canary 上 resolve_rate 恢复 baseline 水平
  // -------------------------------------------------------------------------
  it("e2e: regression signal triggers revert and restores baseline", async () => {
    const config: E2EConfig = {
      workspaceDir: dir,
      promptPath: join(dir, "prompts", "compaction-summary.md"),
      baselineSha,
      canary: MINI_CANARY,
      generations: 1,
      mutationSource: { mode: "improve" } as MutationSource,
      canaryPolicy: PROMOTE_POLICY,
      regressionObservations: REGRESSION_OBS, // 注入回归信号 → 触发 AutoRevert
    };

    const result: CycleResult = await runEvolutionCycle(config);

    // (a) AutoRevert 触发：revertEvent.decision === AUTO_REVERT
    expect(result.revertEvent).not.toBeNull();
    expect((result.revertEvent as ReleaseEvent).decision).toBe("AUTO_REVERT");

    // (b) 回滚后 baseline 在 mini-canary 上 resolve_rate 恢复 baseline 水平
    expect(result.postRevertResolveRate).toBe(result.baselineResolveRate);

    // (c) 回滚本体（CE-T06 revertExec 的 git checkout）已执行：prompts 内容恢复 baseline
    expect(readFileSync(join(dir, "prompts", "compaction-summary.md"), "utf8")).toBe(
      BASELINE_PROMPT,
    );

    // (d) 回滚演练显式走 CE-T06 revertExec（铁律：禁止测试内直接 git checkout）
    //     再次 drill revertExec，断言其 restored=true 且 prompts 仍为 baseline
    const drill = revertExec(baselineSha, { workspaceDir: dir, scope: "prompts" });
    expect(drill.restored).toBe(true);
    expect(readFileSync(join(dir, "prompts", "compaction-summary.md"), "utf8")).toBe(
      BASELINE_PROMPT,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 3（边界：无进化发生也是合法结果）+ RED 名: "e2e: all-rejected generation commits nothing"
  //   Given 优化器产出全部被 held-out 门拒绝（fixture：变异均降分，mutationSource mode=degrade）
  //   When  1 代结束
  //   Then  无 commit、无发布、报告如实记录 retain=0
  // -------------------------------------------------------------------------
  it("e2e: all-rejected generation commits nothing", async () => {
    const config: E2EConfig = {
      workspaceDir: dir,
      promptPath: join(dir, "prompts", "compaction-summary.md"),
      baselineSha,
      canary: MINI_CANARY,
      generations: 1,
      mutationSource: { mode: "degrade" } as MutationSource, // 变异均降分 → 全被拒
      canaryPolicy: PROMOTE_POLICY,
    };

    const before = gitLogCount(dir);
    const result: CycleResult = await runEvolutionCycle(config);

    // (a) 无 commit
    expect(result.committed).toBeNull();

    // (b) git log 不变（commit 数未增加）
    expect(gitLogCount(dir)).toBe(before);

    // (c) 无发布（无 mutant 过门 → 不进 canary）
    expect(result.canaryRelease).toBeNull();

    // (d) 报告如实记录 retain=0
    expect(result.retain).toBe(0);
    expect(result.report).not.toBeNull();
    expect(result.report?.retain).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 场景 4（错误路径）+ RED 名: "g5-report: incomplete evidence throws IncompleteG5Evidence"
  //   Given G5 报告生成器输入不完整（缺 McNemar 输出）
  //   When  g5-report 运行
  //   Then  抛 IncompleteG5Evidence 并列出缺失项（证据不全不得出报告）
  // -------------------------------------------------------------------------
  it("g5-report: incomplete evidence throws IncompleteG5Evidence", () => {
    // 缺 McNemar 输出（mcnemar=null）→ 证据不全
    const incomplete: G5Evidence = {
      mcnemar: null,
      trajectoryMetrics: { resolveRate: 0.8, tokenEfficiency: 0.5 },
      revertLog: { reverted: true, baselineSha },
      canaryLift: { direction: "positive" },
    };

    let caught: unknown;
    try {
      generateG5Report(incomplete);
    } catch (e) {
      caught = e;
    }

    // (a) 抛 IncompleteG5Evidence
    expect(caught).toBeInstanceOf(IncompleteG5Evidence);

    // (b) 列出缺失项（至少含 mcnemar）
    const err = caught as IncompleteG5Evidence;
    expect(Array.isArray(err.missing)).toBe(true);
    expect(err.missing).toContain("mcnemar");

    // (c) 对照：完整证据不抛错，产出非空 markdown 报告（证明 throw 仅针对证据不全，非无条件抛）
    const complete: G5Evidence = {
      mcnemar: { chi2: 0.5, pValue: 0.3, ci: [0, 1] },
      trajectoryMetrics: { resolveRate: 0.8, tokenEfficiency: 0.5 },
      revertLog: { reverted: true, baselineSha },
      canaryLift: { direction: "positive" },
    };
    const report = generateG5Report(complete);
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ambiguities（出题即 spec 压力测试；如实上报，不自行裁决）
//
// 1. [跨模块命名/形状冲突] 引擎入口：XM spec §XM-T01 称 runEvolutionCycle(config: E2EConfig):
//    Promise<CycleResult>，但 L3-T09 spec（execution/L3-engine/TASKS.md）导出的是
//    runEvolutionLoop / EvolveSkillAdapter.runLoop + LoopResult，二者命名与形状均不一致。
//    XM-T01 实现时究竟复用 L3-T09 的 runEvolutionLoop 还是新增 runEvolutionCycle 入口未定义。
//    本测试按 XM spec 锁定 runEvolutionCycle/E2EConfig/CycleResult。
//
// 2. [接口缺定义] E2EConfig / CycleResult 字段形状未在 spec 给出。本测试锁定的最小字段集：
//    E2EConfig = { workspaceDir, promptPath, baselineSha, canary: MiniCanaryTask[],
//                  generations, mutationSource: MutationSource, canaryPolicy: ReleasePolicy,
//                  regressionObservations?: CanaryObservations }
//    CycleResult = { retainedMutants, committed: {sha,origin}|null, canaryRelease: ReleaseEvent|null,
//                    revertEvent: ReleaseEvent|null, baselineResolveRate, postRevertResolveRate,
//                    retain, report: {retain}|null }
//    其中 committed.origin="e2e" 标记来源，commit-on-success 的 git commit 主题须含 "origin=e2e"
//    ——此为 fixture/编排约定，spec 未明示 commit message 形态。
//
// 3. [接口缺定义] MutationSource（FakeLLM 变异源）形状未定义；本测试假设 { mode: "improve"|"degrade" }
//    分别驱动"产出过门 mutant"与"全降分被拒"两条 fixture 路径。
//
// 4. [接口缺定义] MiniCanaryTask 形状未定义；本测试假设 { id, verify, expectedExit }（对齐 CE-T01a
//    CanaryTask 最小子集，省略 decontaminated/frozenInRelease 等 static-core 字段）。
//
// 5. [接口缺定义] CE-T06 revertExec 签名未在 spec 显式给出（spec 仅称"借助 CE-T06 的 revertExec"、
//    "回滚执行体（git checkout）唯一归属 CE-T06 src/revert.ts"）。本测试假设
//    revertExec(baselineSha, { workspaceDir, scope }): { restored: true; sha: string }。
//
// 6. [接口缺定义] scripts/xm/g5-report.ts 的导出形状（G5Evidence / generateG5Report /
//    IncompleteG5Evidence）未在 spec 给出。本测试假设 G5Evidence 含四源：
//    mcnemar(CE-T08) / trajectoryMetrics(TL-T07) / revertLog(回滚演练日志) / canaryLift，
//    generateG5Report 为同步函数返回 markdown 字符串。
//
// 7. [跨模块引用错位] XM spec 顶部"接口契约"称消费"TL-T07（trajectory 导出）"，但 telemetry/TASKS.md
//    中 TL-T07 实为 otel_capture_policy + PII redaction（trajectory 导出实际由 TL-T04 replay +
//    TL-T10 flywheel.exportEvalDataset 承担）。XM-T01 g5-report 消费的"TL-T07 指标"具体指哪个 TL 导出
//    未定义；本测试以 trajectoryMetrics={resolveRate, tokenEfficiency} 作占位形状。
//
// 8. [验收门软化口径] PRD §8.1 将 MVP canary lift 软化为"方向性正 + 非劣性 + 报 budget"，XM-T01
//    场景 1 的 canary lift 断言仅验 PROMOTE 决策存在（方向性），不做统计显著性——与执行提示 (1) 一致。
// ---------------------------------------------------------------------------
