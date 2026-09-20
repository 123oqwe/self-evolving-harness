// L1-T05b · phase 进化 loop-b：select + cache warm-up 软多目标 + canary 配置面
//
// Spec: execution/L1-config/TASKS.md §L1-T05b。
//
// phase prompt 进化闭环第二半（PRD §8.1 交付物 #6；PRD §6.8 cache 软多目标）。
// 核心差异点：cache hit rate 对 phase prompt 是 **warm-up 后稳态度量 + 软多
// 目标**（PRD §6.8——phase prompt 在 cache 前缀内，变异后首轮 cache 必失，
// 若作硬约束则冻结 phase 进化）。
//
// - select = strict-improvement（resolve + SWE-rebench 泛化作硬约束）+ Pareto
//   （cache hit 作软目标，最小化损失不硬=不降；null 时跳过判定，不冻结）。
// - commit-on-success：候选过门 → 写 active phase prompt + staging 版本后缀
//   （`staging/phase-<phase>.v{N}.md`）+ pinSha 重锁。
// - enableShadowWithWarmUp：写 `config/canary-shadow.yaml` 含 `warmUpSessionId`
//   （供 T03 `collectCacheHit` 判 warm-up——T03 执行提示(2) 钉死其为唯一来源）。
// - rollback：复用 T04b `CanaryConfigPlane.rollback`（退化路径从 `rollbackStore`
//   恢复基线快照）。
//
// 实现策略（遵循「同包前序任务文件不删改」规则）：T04b `SelectRetain`/
// `CandidateScore` 已钉死 compaction 形状（substrate:'compaction'、recall/
// resolveRate/cacheHit 三指标），phase 形状不同（substrate:'phase'、resolve/
// sweRebench/cacheHitSteadyState|null 三指标 + 软目标语义），无法字面并入
// `select-retain.ts` 而不越界改写 T04b。故另起 `phase-select-retain.ts`，
// 与 T05a（另起 `phase-evolution-driver.ts`）同构。REFACTOR 留待统一抽象。
//
// REFACTOR：strict-improvement 硬门 + Pareto 软目标抽象为
// `MultiObjectiveGate{hard: Metric[], soft: Metric[]}`，供未来 V1+ 基质
// （tool description 等）复用软多目标模式。

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
import type { PhaseVariantCandidate } from "./phase-evolution-driver.js";
import { rollbackStore } from "./canary-config-plane.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * phase 候选打分（held-out 评测产出）。三指标：
 *
 * - `resolveRate`：held-out resolve_rate，越高越好（硬约束）。
 * - `sweRebenchGeneralization`：held-out decontaminated 泛化率，越高越好
 *   （硬约束——防过拟训练 trajectory）。
 * - `cacheHitSteadyState`：warm-up 后稳态 cache 命中率，越高越好（**软**
 *   目标——Pareto 最小化损失不硬=不降）。`null` = warm-up 未过，跳过 cache
 *   判定，**不冻结 phase 进化**（PRD §6.8）。
 * - `isBaseline`：标记基线分数（select 时作参照）。
 *
 * 字段名/可选性严格对齐 execution/L1-config/TASKS.md §L1-T05b 接口签名。
 */
export interface PhaseCandidateScore {
  readonly candidateId: string;
  readonly phase: "init" | "coding" | "review";
  readonly resolveRate: number;
  readonly sweRebenchGeneralization: number;
  readonly cacheHitSteadyState: number | null;
  readonly isBaseline: boolean;
}

// ── REFACTOR：MultiObjectiveGate（硬约束 + 软约束抽象） ─────────────────────

/**
 * 指标方向。`higher` = 越高越好（resolveRate / sweRebench / cacheHit）；
 * `lower` = 越低越好（recall 等）。
 */
export type MetricDirection = "higher" | "lower";

/**
 * 单个指标度量（硬约束或软约束）。
 *
 * - `key`：候选对象上的字段名（如 `'resolveRate'`）。
 * - `direction`：指标方向。
 * - `tau`：退化容忍阈值。
 *   - 硬约束：退化量 >= tau → reject。
 *   - 软约束：退化量 > tau → reject（损失在容忍内仍可入选，Pareto 最小化损失）。
 *   - 软约束的「>」vs 硬约束的「>=」差异体现软目标「不硬=不降」语义。
 * - `soft`：true = 软目标（损失在 tau 内仍入选）；false = 硬约束（退化即 reject）。
 * - `nullable`：true = 字段可为 null，null 时跳过该指标判定（warm-up 未过 →
 *   不冻结，PRD §6.8）。
 */
export interface Metric<TScore> {
  readonly key: keyof TScore & string;
  readonly direction: MetricDirection;
  readonly tau: number;
  readonly soft: boolean;
  readonly nullable: boolean;
}

/**
 * 多目标门：硬约束指标集 + 软约束指标集。
 *
 * 硬约束任一退化 >= tau → reject；软约束退化 > tau → reject（损失在容忍内
 * 仍可入选，Pareto 最小化损失不硬=不降）。nullable 软目标为 null 时跳过
 * 判定（不冻结进化，PRD §6.8）。
 *
 * 抽象供未来 V1+ 基质（tool description 等）复用软多目标模式。
 */
export interface MultiObjectiveGate<TScore> {
  readonly hard: readonly Metric<TScore>[];
  readonly soft: readonly Metric<TScore>[];
}

/** 计算候选相对 baseline 的退化量（正数 = 退化）。 */
function degradation(
  candidateVal: number,
  baselineVal: number,
  direction: MetricDirection,
): number {
  return direction === "higher" ? baselineVal - candidateVal : candidateVal - baselineVal;
}

/**
 * 用 gate 判定候选是否通过。
 *
 * - 硬约束：退化 >= tau → reject（return false）。
 * - 软约束：退化 > tau → reject（损失在容忍内仍入选）。
 * - nullable 软目标为 null（或 baseline 为 null）→ 跳过判定（不冻结）。
 */
function passesGate<TScore>(
  candidate: TScore,
  baseline: TScore,
  gate: MultiObjectiveGate<TScore>,
): boolean {
  for (const m of gate.hard) {
    const cv = (candidate as Record<string, unknown>)[m.key];
    const bv = (baseline as Record<string, unknown>)[m.key];
    if (typeof cv !== "number" || typeof bv !== "number") continue;
    if (degradation(cv, bv, m.direction) >= m.tau) return false;
  }
  for (const m of gate.soft) {
    const cv = (candidate as Record<string, unknown>)[m.key];
    const bv = (baseline as Record<string, unknown>)[m.key];
    if (m.nullable && (cv === null || bv === null)) continue; // warm-up 未过 → 跳过，不冻结
    if (typeof cv !== "number" || typeof bv !== "number") continue;
    if (degradation(cv, bv, m.direction) > m.tau) return false; // 稳态发散 → reject
  }
  return true;
}

// ── phase gate 工厂 ─────────────────────────────────────────────────────────

/**
 * 构建 phase select 的多目标门：resolve + sweRebench 硬约束（退化 >= tau
 * → reject），cacheHitSteadyState 软约束（损失 > tauCache → reject；null →
 * 跳过不冻结）。
 */
function phaseGate(tau: number, tauCache: number): MultiObjectiveGate<PhaseCandidateScore> {
  return {
    hard: [
      { key: "resolveRate", direction: "higher", tau, soft: false, nullable: false },
      { key: "sweRebenchGeneralization", direction: "higher", tau, soft: false, nullable: false },
    ],
    soft: [
      { key: "cacheHitSteadyState", direction: "higher", tau: tauCache, soft: true, nullable: true },
    ],
  };
}

// ── PhaseSelectRetain ──────────────────────────────────────────────────────

/**
 * PhaseSelectRetain 构造 opts。
 *
 * `repo`：ConfigRepo（commit-on-success 写 active + staging + pinSha）。
 * `select` 为纯函数无 IO，repo 可选（仅 select 调用时可不传）。ERRATA-w2plus
 * 风格：opts 结构化注入。
 */
export interface PhaseSelectRetainOptions {
  readonly repo?: ConfigRepo;
}

const PHASE_STAGING_DIR = "staging";

/**
 * phase 进化 loop-b：strict-improvement（resolve + sweRebench 硬约束）+
 * Pareto（cacheHitSteadyState 软目标，最小化损失不硬=不降；null 跳过不冻结）
 * + commit-on-success retain + canary shadow warm-up 标记。
 *
 * `select` 为纯函数无 IO；`commitOnSuccess`/`enableShadowWithWarmUp` 触盘。
 */
export class PhaseSelectRetain {
  private readonly repo: ConfigRepo | undefined;

  constructor(opts: PhaseSelectRetainOptions) {
    this.repo = opts.repo;
  }

  /**
   * select：候选须同时过 resolve + sweRebench 硬约束（退化 >= tau → reject）
   * 与 cacheHitSteadyState 软约束（稳态损失 > tauCache → reject；null → 跳过
   * 不冻结 phase 进化，PRD §6.8）。过门候选入 Pareto 前沿输出。
   */
  select(
    candidates: PhaseCandidateScore[],
    baseline: PhaseCandidateScore,
    tau: number,
    tauCache: number,
  ): PhaseCandidateScore[] {
    const gate = phaseGate(tau, tauCache);
    return candidates.filter((c) => passesGate(c, baseline, gate));
  }

  /**
   * commit-on-success：候选过门 → 写 active phase prompt
   * （`prompts/phase-<phase>.md`）+ staging 版本后缀
   * （`staging/phase-<phase>.v{N}.md`，可回滚）+ 调 `ConfigRepo.pinSha` 重锁。
   *
   * 写 active 前把基线内容存入 `rollbackStore`，供 `CanaryConfigPlane.rollback`
   * 恢复（退化信号 → active sha 回到回滚前 HEAD = 基线）。
   *
   * 版本后缀是回滚的物理基础（PRD §6.4 keep-all variant）。
   */
  commitOnSuccess(candidate: PhaseVariantCandidate, _scores: PhaseCandidateScore[]): void {
    if (!this.repo) {
      throw new Error("PhaseSelectRetain.commitOnSuccess requires a ConfigRepo (repo unset)");
    }
    const root = this.repo.getRoot();
    const activeRel = `prompts/phase-${candidate.phase}.md`;
    const activeAbs = join(root, activeRel);

    // 写 active 前存基线快照（供 CanaryConfigPlane.rollback 恢复）
    if (existsSync(activeAbs)) {
      rollbackStore.set(activeAbs, readFileSync(activeAbs, "utf8"));
    }

    // 写 staging 版本后缀（keep-all variant，回滚物理基础）
    const stagingDir = join(root, PHASE_STAGING_DIR);
    mkdirSync(stagingDir, { recursive: true });
    const next = nextPhaseVersion(stagingDir, candidate.phase);
    const stagingAbs = join(stagingDir, `phase-${candidate.phase}.v${next}.md`);
    writeFileSync(stagingAbs, candidate.content, "utf8");

    // 写 active（内容更新）
    mkdirSync(join(root, "prompts"), { recursive: true });
    writeFileSync(activeAbs, candidate.content, "utf8");

    // 调 ConfigRepo.pinSha 重锁（versionSha 用新内容 sha，生产由 git HEAD 提供，
    // 此处占位保证单一真值源贯穿——loadActive 反映新内容）
    const newSha = createHash("sha256").update(candidate.content).digest("hex");
    this.repo.pinSha(newSha);
  }

  /**
   * 写 `config/canary-shadow.yaml`，指向 staging 路径 + shadow 5% +
   * `warmUpSessionId`（供 T03 `collectCacheHit` 判 warm-up——spec 执行提示(2)
   * 钉死其为唯一来源）。
   */
  enableShadowWithWarmUp(stagingPath: string, warmUpSessionId: string): void {
    if (!this.repo) {
      throw new Error("PhaseSelectRetain.enableShadowWithWarmUp requires a ConfigRepo (repo unset)");
    }
    const root = this.repo.getRoot();
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const yaml = [
      `substrate: phase`,
      `shadowPath: ${stagingPath}`,
      `percent: 5`,
      `enabled: true`,
      `warmUpSessionId: ${warmUpSessionId}`,
      ``,
    ].join("\n");
    writeFileSync(join(configDir, "canary-shadow.yaml"), yaml, "utf8");
  }
}

// ── 内部纯函数 ─────────────────────────────────────────────────────────────

/**
 * 扫描 staging 目录现有 `phase-<phase>.v{N}.md`，返回下一版本号。
 * 无既有版本 → 2（Voyager 起始约定）；有 → max(N)+1。
 */
function nextPhaseVersion(stagingDir: string, phase: "init" | "coding" | "review"): number {
  let max = 1;
  if (existsSync(stagingDir)) {
    for (const name of readdirSync(stagingDir) as string[]) {
      const re = new RegExp(`^phase-${phase}\\.v(\\d+)\\.md$`);
      const m = re.exec(name);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}
