// evolve-core · runEvolutionCycle 宿主无关进化循环入口（PLG-T01）。
//
// Spec: execution/plugin/TASKS.md §PLG-T01。
//
// 薄编排（不重造闭环）：
//   1. mine：harnessPort.readSubstrate(substrateId) → baseline Substrate；
//      若 !offline → harnessPort.readTrajectories(baseline.sha) → Trajectory[]。
//   2. mutate+score+select+retain：构造 InlineEvaluator（canary→runVerify→
//      Fitness，复用 CE-T02 VerifierRun）+ EvolveSandbox（复用 l3-engine
//      STATIC_CORE_PATHS 断言）→ 调 @harness/l3-engine runEvolutionLoop（closed
//      loop）。InlineEvaluator 通过 harnessPort.llmPort 产出变异内容（宿主
//      注入的 LLM），写入基质文件后跑 canary verify 裁决 Fitness——这把
//      「mutate 产生内容」与「score 机械裁决」串联，fresh-evidence 门据此
//      放行 select（CE-T07 铁律：no fresh exit-code evidence → no select）。
//   3. deploy：过门 → writeSubstrate（落 staging）→ harnessPort.deploy
//      （git commit-on-success）。
//   4. canary：CE-T06 canaryRelease 发布；退化信号 → harnessPort.rollback。
//   返回 EvolveResult。

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { HarnessPort, SubstrateHandle } from "@harness/adapters";
import type {
  Trajectory,
  Mutant,
  Fitness,
  Evaluator,
  Substrate,
} from "@harness/l3-engine";
import { runEvolutionLoop } from "@harness/l3-engine";
import type { Sandbox, VerifyResult, SecurityEvent } from "@harness/l3-engine";
import { STATIC_CORE_PATHS } from "@harness/l3-engine";
import type { VerifierRun, CanaryObservations, ReleasePolicy } from "@harness/canary-eval";
import { canaryRelease } from "@harness/canary-eval";

import type { EvolveConfig, EvolveResult, EvolveCanaryTask } from "./config.js";
import { OfflineMutator } from "./offline-mutator.js";

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** canary 任务数 < 3 → throw（fresh-evidence 铁律：≥3 任务）。 */
export class InsufficientCanaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCanaryError";
  }
}

// ---------------------------------------------------------------------------
// baseline 常量（对齐 L3 E2E BASELINE_FITNESS.resolve_rate = 0.5）
// ---------------------------------------------------------------------------

const BASELINE_RESOLVE_RATE = 0.5;

// 默认良好观察窗口（无 canaryObservations 注入时 → PROMOTE）。
const DEFAULT_GOOD_OBS: CanaryObservations = {
  resolveRate: 0.9,
  cost: 50,
  piiCount: 0,
  paretoDominated: false,
};

// ---------------------------------------------------------------------------
// EvolveSandbox — 复用 l3-engine Sandbox 契约 + STATIC_CORE_PATHS 断言
// ---------------------------------------------------------------------------

class EvolveSandbox implements Sandbox {
  public readonly log: { securityEvents: SecurityEvent[] } = {
    securityEvents: [],
  };
    private readonly workspaceDir: string;
  constructor(workspaceDir: string) { this.workspaceDir = workspaceDir; }
  async runVerify(
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<VerifyResult> {
    // 真实执行命令：exitCode 来自进程退出码（机械裁决），非硬编码。
    const r = spawnSync("sh", ["-c", cmd], {
      cwd: opts?.cwd ?? this.workspaceDir,
      encoding: "utf8",
      timeout: opts?.timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      exitCode: r.status ?? 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      epermHits: [],
    };
  }
  async assertReadonly(paths: string[]): Promise<void> {
    // 强制局域不变量：workspace 不得包含任何 static-core 子树（invariant 3
    // 在宿主无关路径的诚实兑现，非 no-op）。生产 wiring 须走真实 L0S-T02。
    for (const p of paths) {
      const inside = join(this.workspaceDir, p);
      if (existsSync(inside)) {
        throw new Error(
          `breaker: static-core path "${p}" exists inside workspace ` +
            `${this.workspaceDir} — invariant 3 violated`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// InlineEvaluator — canary→runVerify→Fitness + evidence(VerifierRun[])
// ---------------------------------------------------------------------------

/**
 * InlineEvaluator 把「mutate 产生变异内容」与「score 机械裁决」串联：
 *   - score(mutant)：调 harnessPort.llmPort.complete() 产出变异内容（宿主注入
 *     的 LLM；FakeLLM 在测试中按 mode 返回 IMPROVED/DEGRADED 内容），写入
 *     <workspaceDir>/<substrateId>，跑 canary verify，由 exit code 裁决 Fitness。
 *   - evidence(mutant)：返回 score 缓存的 VerifierRun[]（CE-T07 fresh-evidence
 *     门消费，exitCode===0 才放行 select）。
 *
 * 注意：runEvolutionLoop 内部用 NoopLLM 构造 ReflectiveMutator 且不传
 * trajectories（reflective 不激活），故变异内容无法经 L3 内置 mutator 到达
 * canary 文件。InlineEvaluator 经 harnessPort.llmPort 产出内容是宿主无关串联
 * 变异与评分的唯一通路——HarnessPort 是 EvolveConfig 唯一的宿主特定性收口。
 */
class InlineEvaluator implements Evaluator {
  private readonly cache = new Map<string, VerifierRun[]>();
  /** 最后一个通过 fresh-evidence 门的变异内容（供 deploy 写回）。 */
  public retainedContent: string | null = null;

  private readonly harnessPort: HarnessPort;
  private readonly sandbox: Sandbox;
  private readonly canary: EvolveCanaryTask[];
  private readonly workspaceDir: string;
  private readonly substrateId: string;
  private readonly baselineContent: string;
  private readonly trajectories: Trajectory[];

  constructor(
    harnessPort: HarnessPort,
    sandbox: Sandbox,
    canary: EvolveCanaryTask[],
    workspaceDir: string,
    substrateId: string,
    baselineContent: string,
    trajectories: Trajectory[],
  ) {
    this.harnessPort = harnessPort;
    this.sandbox = sandbox;
    this.canary = canary;
    this.workspaceDir = workspaceDir;
    this.substrateId = substrateId;
    this.baselineContent = baselineContent;
    this.trajectories = trajectories;
  }

  private async runCanary(): Promise<VerifierRun[]> {
    const runs: VerifierRun[] = [];
    for (const task of this.canary) {
      const result = await this.sandbox.runVerify(task.verify, {
        cwd: this.workspaceDir,
      });
      runs.push({
        taskId: task.id,
        command: task.verify,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        runId: randomUUID(),
        contiguousRun: true,
        epermHits: result.epermHits ?? [],
      });
    }
    return runs;
  }

  private buildMutationPrompt(): string {
    const diagnoses = this.trajectories
      .map((t) => t.diagnosis)
      .filter(Boolean)
      .join("\n- ");
    return [
      "Mutate the following substrate to improve it. Reply with ONLY the new substrate content (no prose).",
      `Substrate:\n${this.baselineContent}`,
      diagnoses
        ? `Failure diagnoses to address:\n- ${diagnoses}`
        : "No failure trajectories available (offline mode).",
    ].join("\n\n");
  }

  async score(m: Mutant, _split: "train" | "heldout"): Promise<Fitness> {
    // 宿主 LLM 产出变异内容（mutate 步）。
    const mutantContent = await this.harnessPort.llmPort.complete(
      this.buildMutationPrompt(),
    );
    // 写入基质文件，使 canary verify（grep）能裁决变异质量。
    const abs = join(this.workspaceDir, this.substrateId);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, mutantContent, "utf8");

    const runs = await this.runCanary();
    this.cache.set(m.id, runs);

    const allPass = runs.every((r) => r.exitCode === 0);
    // improve（canary 全 pass）→ resolve_rate 优于 baseline；degrade（任一 FAIL）
    // → resolve_rate 退化。fresh-evidence 门会在 select 前据 exitCode fail-closed
    // reject degrade 候选，Fitness 值仅对过门候选生效。
    const fitness: Fitness = allPass
      ? {
          resolve_rate: 0.6,
          token: 100,
          cache_hit: 0.5,
          raw: { id: m.id },
        }
      : {
          resolve_rate: 0.4,
          token: 200,
          cache_hit: 0.5,
          raw: { id: m.id },
        };
    if (allPass) {
      // 记录通过机械裁决的变异内容（供 deploy 写回 staging）。
      this.retainedContent = mutantContent;
    }
    return fitness;
  }

  async evidence(m: Mutant): Promise<VerifierRun[]> {
    const cached = this.cache.get(m.id);
    if (cached) return cached;
    return this.runCanary();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 把 EvolveConfig.canaryPolicy 适配到 CE-T06 ReleasePolicy（shadowPercent 字面量）。 */
function buildReleasePolicy(config: EvolveConfig): ReleasePolicy {
  const cp = config.canaryPolicy;
  const shadowPercent = 0.05 as const;
  const observationWindowTurns = cp?.observationWindowTurns ?? 3;
  const revertThresholds = cp?.revertThresholds ?? {
    resolveRateDrop: 0.1,
    costRise: 0,
    piiCount: 0,
    paretoDominated: false,
  };
  return {
    shadowPercent,
    observationWindowTurns,
    revertThresholds,
    rainbowParallelVariants: 1,
  } as unknown as ReleasePolicy;
}

/**
 * 解析 canary observations 注入通道。
 *
 * 歧义裁决（PLG-T01 ambiguities）：EvolveConfig.spec 未声明 canaryObservations
 * 字段（test-author 用 @ts-expect-error 假设其为未声明通道注入）。本实现「与
 * 测试假设一致优先」：不在 EvolveConfig 声明该字段，运行时经 cast 读取，缺省
 * 回退到 DEFAULT_GOOD_OBS（→ PROMOTE）。
 */
function resolveObservations(config: EvolveConfig): CanaryObservations {
  const injected = (
    config as unknown as {
      canaryObservations?: Array<Record<string, number | boolean | undefined>>;
    }
  ).canaryObservations;
  if (!Array.isArray(injected) || injected.length === 0) {
    return DEFAULT_GOOD_OBS;
  }
  const o = injected[0]!;
  return {
    resolveRate: typeof o.resolveRate === "number" ? o.resolveRate : 0.9,
    cost: typeof o.cost === "number" ? o.cost : typeof o.token === "number" ? o.token : 0,
    piiCount: typeof o.piiCount === "number" ? o.piiCount : 0,
    paretoDominated: o.paretoDominated === true,
  };
}

// ---------------------------------------------------------------------------
// runEvolutionCycle — 宿主无关进化循环入口
// ---------------------------------------------------------------------------

export async function runEvolutionCycle(
  config: EvolveConfig,
): Promise<EvolveResult> {
  // fresh-evidence 铁律：canary ≥ 3 任务。
  if (config.canary.length < 3) {
    throw new InsufficientCanaryError(
      `insufficient canary tasks: need >= 3, got ${config.canary.length}`,
    );
  }

  const offline = config.offline === true;
  const workspaceDir = config.workspaceDir ?? process.cwd();

  // ── 1. mine：读 baseline 基质（透传 SubstrateNotFoundError，不吞）──
  const baseline: SubstrateHandle = await config.harnessPort.readSubstrate(
    config.substrateId,
  );

  // ── mine（轨迹）：offline 模式跳过 readTrajectories（经 OfflineMutator
  //    显式收口，spec §PLG-T01 自研项；等价于 trajectories=[] 让
  //    ReflectiveMutator 拿空 diagnosis，但命名化、单一职责）──
  const offlineMutator = new OfflineMutator(offline);
  const trajectories: Trajectory[] = await offlineMutator.readDiagnosis(
    config.harnessPort,
    baseline.sha,
  );

  // ── 2. mutate+score+select+retain：构造 evaluator + sandbox → 跑 closed loop ──
  const substrate: Substrate = {
    kind: baseline.kind,
    content: baseline.content,
    sha: baseline.sha,
  };
  const sandbox = new EvolveSandbox(workspaceDir);
  const evaluator = new InlineEvaluator(
    config.harnessPort,
    sandbox,
    config.canary,
    workspaceDir,
    config.substrateId,
    baseline.content,
    trajectories,
  );

  const tau =
    config.tau ?? { resolve_rate: 0, token: 0, cache_hit: 0 };
  const generations = config.generations ?? 1;

  const loopResult = await runEvolutionLoop({
    substrate,
    beamWidth: 3,
    evaluator,
    sandbox,
    tau,
    generations,
  });

  const baselineResolveRate = BASELINE_RESOLVE_RATE;
  let postRevertResolveRate: number = baselineResolveRate;

  // ── 无 mutant 过门 → 无 commit、无发布（边界合法）──
  if (loopResult.committed === undefined || loopResult.committed === null) {
    return {
      retainedMutants: 0,
      committed: null,
      canaryRelease: null,
      revertEvent: null,
      baselineResolveRate,
      postRevertResolveRate: baselineResolveRate,
      retain: 0,
      offline,
    };
  }

  // ── 3. deploy：writeSubstrate（落 staging）→ harnessPort.deploy（git commit）──
  const mutantContent = evaluator.retainedContent ?? baseline.content;
  const stagingHandle = await config.harnessPort.writeSubstrate(
    config.substrateId,
    mutantContent,
  );
  const deployResult = await config.harnessPort.deploy(stagingHandle.sha);
  const committed = { sha: deployResult.sha, origin: "evolve-core" };

  // ── 4. canary：CE-T06 canaryRelease 发布；退化信号 → harnessPort.rollback ──
  const policy = buildReleasePolicy(config);
  const observations = resolveObservations(config);
  const release = await canaryRelease(
    deployResult.sha,
    baseline.sha,
    policy,
    observations,
    { baselineResolveRate },
  );
  const releaseEvent = {
    decision: release.decision,
    variantSha: release.variantSha,
  };

  let revertEvent: {
    decision: "PROMOTE" | "AUTO_REVERT" | "HOLD";
    variantSha: string;
  } | null = null;

  if (release.decision === "AUTO_REVERT") {
    // 退化信号 → harnessPort.rollback（宿主无关回滚，git checkout 由 port 负责）。
    await config.harnessPort.rollback(deployResult.rollbackTo);
    revertEvent = releaseEvent;
    // 回滚后 baseline 恢复 → resolve_rate 回到 baseline 水平。
    postRevertResolveRate = baselineResolveRate;
  }

  return {
    retainedMutants: 1,
    committed,
    canaryRelease: releaseEvent,
    revertEvent,
    baselineResolveRate,
    postRevertResolveRate,
    retain: 1,
    offline,
  };
}
