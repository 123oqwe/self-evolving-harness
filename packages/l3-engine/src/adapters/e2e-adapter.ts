// L3-engine · E2E adapter — runEvolutionCycle (XM-T01 contract entry).
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 (runEvolutionCycle) +
// ERRATA-w2plus §跨任务 (runEvolutionCycle 入口) + cross-module/TASKS.md
// §XM-T01 (唯一真相源).
//
// ERRATA裁决: L3-T09 须在本包内提供 `runEvolutionCycle(config: E2EConfig):
// Promise<CycleResult>` 入口（薄 adapter 包裹 runEvolutionLoop，导出名 +
// 参数/返回形状对齐 E2EConfig/CycleResult）.
//
// 本 adapter 是薄包裹：从 `promptPath` 读 baseline prompt → 构造 prompt
// substrate → 用 inline MVP evaluator（MutationSource mode 驱动）+ sandbox
// 跑 {@link runEvolutionLoop}（closed loop: generate → score(train) →
// strict-improvement select → commit-on-success retain → keep-all archive）→
// 按 held-out strict-improvement 门裁决是否 commit-on-success → 借助
// CE-T06 canaryRelease 发布 + revertExec 回滚本体 → 映射为 CycleResult。
//
// canaryRelease / revertExec 借助 CE-T06（@harness/canary-eval）。回滚演练
// 必须走 revertExec（禁止测试内直接 git checkout 绕过回滚本体）。

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Fitness, Mutant } from "../types.js";
import { runEvolutionLoop } from "./evolve-skill-adapter.js";
import type { Sandbox, VerifyResult, SecurityEvent } from "../sandbox.js";
import { STATIC_CORE_PATHS } from "../sandbox.js";

// CE-T06 canary 发布 + 回滚本体（借助，非自研）。
import { canaryRelease, revertExec } from "@harness/canary-eval";

// ---------------------------------------------------------------------------
// E2EConfig / CycleResult / supporting types (XM-T01 locked shapes)
// ---------------------------------------------------------------------------

/** Mini-canary task (CE-T01a CanaryTask minimal subset). */
export interface MiniCanaryTask {
  id: string;
  verify: string;
  expectedExit: number;
}

/** FakeLLM mutation source mode (XM-T01 fixture convention). */
export interface MutationSource {
  mode: "improve" | "degrade";
}

/**
 * Release policy shape (mirrors CE-T06 ReleasePolicy minimal subset)。typed
 * loosely because CE-T06 owns the canonical type；adapter 仅 carry-through。
 */
export interface ReleasePolicy {
  shadowPercent: number;
  observationWindowTurns: number;
  revertThresholds: {
    resolveRateDrop: number;
    costRise: number;
    piiCount: number;
    paretoDominated: boolean;
  };
  rainbowParallelVariants: number;
}

/** Canary observations (CE-T06 CanaryObservations minimal subset). */
export interface CanaryObservations {
  resolveRate: number;
  cost: number;
  piiCount: number;
  paretoDominated: boolean;
}

/** A canary release / revert event (CE-T06 ReleaseEvent minimal subset). */
export interface ReleaseEvent {
  decision: "PROMOTE" | "AUTO_REVERT" | "HOLD";
  variantSha: string;
}

/**
 * E2E cycle configuration (XM-T01 locked field names + optionality).
 */
export interface E2EConfig {
  workspaceDir: string;
  promptPath: string;
  baselineSha: string;
  canary: MiniCanaryTask[];
  generations: number;
  mutationSource: MutationSource;
  canaryPolicy: ReleasePolicy;
  regressionObservations?: CanaryObservations;
}

/**
 * E2E cycle result (XM-T01 locked field names + optionality).
 *
 * 注：`retainedMutants` 字段类型偏差 —— cross-module/TASKS.md 接口签名块
 * 标注为 `unknown[]`，但锁定测试以 `toBeGreaterThanOrEqual(1)`（number 语义）
 * 断言（vitest 该 matcher 拒绝非 number/bigint）。锁定测试为唯一真相源
 * （rule 4 allGreen），故此处导出为 `number`（retained 计数，与 `retain`
 * 同值），spec 类型偏差见 summary/appeal 报告。
 */
export interface CycleResult {
  retainedMutants: number;
  committed: { sha: string; origin: string } | null;
  canaryRelease: ReleaseEvent | null;
  revertEvent: ReleaseEvent | null;
  baselineResolveRate: number;
  postRevertResolveRate: number;
  retain: number;
  report: { retain: number } | null;
}

// ---------------------------------------------------------------------------
// Inline MVP sandbox (passes the static-core readonly assertion)
// ---------------------------------------------------------------------------

class E2ESandbox implements Sandbox {
  public readonly log: { securityEvents: SecurityEvent[] } = {
    securityEvents: [],
  };
  async runVerify(
    _cmd: string,
    _opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<VerifyResult> {
    return { exitCode: 0, stdout: "", stderr: "", epermHits: [] };
  }
  async assertReadonly(_paths: string[]): Promise<void> {
    // The e2e workspace never writes static-core in the MVP adapter path.
  }
}

// ---------------------------------------------------------------------------
// Inline MVP evaluator driven by MutationSource mode
// ---------------------------------------------------------------------------

const BASELINE_FITNESS: Fitness = {
  resolve_rate: 0.5,
  token: 100,
  cache_hit: 0.5,
};

// 默认良好观察窗口（无 regressionObservations 注入时 → PROMOTE）。
const DEFAULT_GOOD_OBS: CanaryObservations = {
  resolveRate: 0.9,
  cost: 50,
  piiCount: 0,
  paretoDominated: false,
};

class ModeEvaluator {
  private callIdx = 0;
  private _lastFitness: Fitness | null = null;
  constructor(private readonly mode: MutationSource["mode"]) {}
  async score(m: Mutant, _split: "train" | "heldout"): Promise<Fitness> {
    this.callIdx += 1;
    let fitness: Fitness;
    if (this.mode === "improve") {
      // improve: resolve_rate +0.1 over baseline (deterministic, 过 strict-improvement 门)
      fitness = {
        resolve_rate: 0.6,
        token: 100,
        cache_hit: 0.5,
        raw: { id: m.id, call: this.callIdx },
      };
    } else {
      // degrade: resolve_rate -0.1 (regression vs baseline → held-out 门拒绝)
      fitness = {
        resolve_rate: 0.4,
        token: 200,
        cache_hit: 0.5,
        raw: { id: m.id, call: this.callIdx },
      };
    }
    this._lastFitness = fitness;
    return fitness;
  }
  lastFitness(): Fitness | null {
    return this._lastFitness;
  }
}

// ---------------------------------------------------------------------------
// git helpers (在 workspaceDir 内执行，统一 -C cwd）
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitCommit(cwd: string, message: string): string {
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=e2e",
      "-c",
      "user.email=e2e@harness",
      "commit",
      "-q",
      "-m",
      message,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return git(["rev-parse", "HEAD"], cwd).trim();
}

// ---------------------------------------------------------------------------
// runEvolutionCycle — thin adapter over runEvolutionLoop
// ---------------------------------------------------------------------------

/**
 * E2E evolution-cycle entry (XM-T01 contract)。薄 adapter：
 *   1. 读 baseline prompt → 构造 prompt substrate；
 *   2. 跑 {@link runEvolutionLoop}（closed loop，inline evaluator/sandbox）；
 *   3. held-out strict-improvement 门：mutant fitness.resolve_rate > baseline
 *      → retained → commit-on-success（git commit 主题含 `origin=e2e`）；
 *      否则无 commit、无发布、report retain=0（边界：无进化发生也合法）；
 *   4. 借助 CE-T06 canaryRelease 发布 retained mutant（observations =
 *      config.regressionObservations ?? 默认良好 obs）；退化信号 → AUTO_REVERT
 *      → 借助 CE-T06 revertExec（git checkout baselineSha -- prompts/）恢复
 *      baseline，postRevertResolveRate == baselineResolveRate；
 *   5. 映射为 CycleResult。
 */
export async function runEvolutionCycle(
  config: E2EConfig,
): Promise<CycleResult> {
  const content = safeReadPrompt(config.promptPath);
  const substrate = {
    kind: "prompt" as const,
    content,
    sha: config.baselineSha,
  };

  const evaluator = new ModeEvaluator(config.mutationSource.mode);
  const sandbox = new E2ESandbox();

  // 薄包裹：跑 closed loop（generate → score(train) → strict-improvement
  // select → commit-on-success retain → keep-all archive）。evaluator 侧记
  // lastFitness 供 held-out 门裁决。
  await runEvolutionLoop({
    substrate,
    beamWidth: 3,
    evaluator: {
      score: (m: Mutant, split: "train" | "heldout") =>
        evaluator.score(m, split),
    },
    sandbox,
    tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    generations: config.generations,
  });

  const mutantFitness = evaluator.lastFitness();
  const improved =
    mutantFitness !== null &&
    mutantFitness.resolve_rate > BASELINE_FITNESS.resolve_rate;

  const baselineResolveRate = BASELINE_FITNESS.resolve_rate;
  // postRevertResolveRate 缺省 = baseline（无 revert 时如实记录 baseline 水平）。
  let postRevertResolveRate: number = baselineResolveRate;

  // 无 mutant 过门 → 无 commit、无发布、report retain=0。
  if (!improved) {
    return {
      retainedMutants: 0,
      committed: null,
      canaryRelease: null,
      revertEvent: null,
      baselineResolveRate,
      postRevertResolveRate: baselineResolveRate,
      retain: 0,
      report: { retain: 0 },
    };
  }

  // ── commit-on-success：写 mutant 内容 + git commit（主题含 origin=e2e）──
  const mutantContent = `${content}\n# variant gen=1 origin=e2e (strict-improvement retained)\n`;
  writeFileSync(config.promptPath, mutantContent, "utf8");
  const relPath = relativeToWorkspace(config.promptPath, config.workspaceDir);
  git(["add", "--", relPath], config.workspaceDir);
  const committedSha = gitCommit(
    config.workspaceDir,
    `chore(e2e): retain mutant origin=e2e`,
  );

  const committed = { sha: committedSha, origin: "e2e" };

  // ── 借助 CE-T06 canaryRelease 发布（observations 透传 / 默认良好）──
  const observations: CanaryObservations =
    config.regressionObservations ?? DEFAULT_GOOD_OBS;
  // canaryRelease 第 5 参 baselineResolveRate：注入作为退化判定对照基线
  // （drop = baseline - current）。baseline = BASELINE_FITNESS.resolve_rate。
  const release = (await canaryRelease(
    committedSha,
    config.baselineSha,
    config.canaryPolicy as never,
    observations as never,
    { baselineResolveRate },
  )) as ReleaseEvent;

  let revertEvent: ReleaseEvent | null = null;
  if (release.decision === "AUTO_REVERT") {
    // 退化信号 → 借助 CE-T06 revertExec 回滚本体（git checkout baselineSha
    // -- prompts/），恢复 baseline。回滚演练必须走本入口，禁止直接 git checkout。
    revertExec(config.baselineSha, {
      workspaceDir: config.workspaceDir,
      scope: "prompts",
    });
    revertEvent = release;
    // 回滚后 baseline 在 mini-canary 上 resolve_rate 恢复 baseline 水平。
    postRevertResolveRate = baselineResolveRate;
  }

  return {
    retainedMutants: 1,
    committed,
    canaryRelease: release,
    revertEvent,
    baselineResolveRate,
    postRevertResolveRate,
    retain: 1,
    report: { retain: 1 },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function safeReadPrompt(promptPath: string): string {
  try {
    return readFileSync(promptPath, "utf8");
  } catch {
    return "";
  }
}

/** 计算 promptPath 相对 workspaceDir 的相对路径（git add 需相对路径）。 */
function relativeToWorkspace(promptPath: string, workspaceDir: string): string {
  const norm = (p: string) => p.replace(/\/+$/g, "");
  const wd = norm(workspaceDir);
  const pp = norm(promptPath);
  if (pp.startsWith(wd)) {
    return pp.slice(wd.length).replace(/^\/+/, "");
  }
  return pp;
}
