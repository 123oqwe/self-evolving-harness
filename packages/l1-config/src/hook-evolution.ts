// L1-T12b · hook policy 进化 loop（AgentDojo/ASB 双 Pareto safety∧utility；agent 绝对无写权）
//
// 进化闭环——生成 hook 规则变异候选 + breaker precheck + 双目标 strict-improvement
// select（PRD §8.1 交付物 #5；02-loop-context §1.5）。复用 L1-T12a `HookPolicy` 的
// breaker clause 作为候选预检硬门：任何把 bash/write/edit 从 deny/ask 放宽到 allow
// 的候选自动 reject，不进候选集。
//
// 安全不变量（PRD §6.6/§11.3）：
//   1. mutator 在沙箱内、用独立 session 执行（防 self-critic 饱和 PRD §6.2/E2 +
//      prompt injection 持久化 R17）；mutatorSession ≠ agent 运行时 session。
//   2. breaker precheck —— 候选 patch 含 bash/write/edit 从 deny/ask 放宽到 allow
//      的 diff → reject（不进候选集），落 `candidate_rejected_breaker` 事件。
//      收紧方向（allow→deny/ask）放行。
//   3. agent 运行时绝对无写权（L0C-T11 只读强制）——本驱动**不暴露任何** policy
//      写入入口（无 writePolicy / writePolicyYaml）；staging/active 写入由 commit
//      层（本任务范围外）经人审 gate 执行。
//
// 双目标 select（AgentDojo attackSuccessRate↓ ∧ ASB falseDenyRate↓，均越低越好）：
//   strict-improvement 门——候选须在两指标上均不劣于 baseline 且至少一项严格更优
//   （Pareto-vs-baseline 非支配）。任一指标退化（candidate > baseline）→ reject。
//   不加权求和（PRD §6.7 多目标独立裁决）。
//
// 错误降级：mutator 调用失败（LLM 不可用）→ 返回空候选 + 落 `mutator_failed` 事件，
// 不抛（进化是离线批处理，失败优雅降级）。失败 trajectory 为空 → 返回空候选。

import { createHash, randomUUID } from "node:crypto";
import type { HookRule, BreakerDiff } from "./hook-policy.js";
import { HookPolicy } from "./hook-policy.js";
import type { LlmMutator, FailureTrajectory, SandboxExecutor } from "./evolution-driver.js";
import type { TelemetrySink } from "./compaction-substrate.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * 候选打分（AgentDojo + ASB held-out 评测产出）。双指标无加权——strict-improvement
 * 各自独立判断，不得求和（PRD §6.7）。
 *
 * - attackSuccessRate：AgentDojo 攻击成功率，越低越好（safety）。
 * - falseDenyRate：ASB 误拒率，越低越好（utility）。
 * - isBaseline：标记基线分数（select 时作参照，不进候选输出）。
 */
export interface HookCandidateScore {
  readonly attackSuccessRate: number;
  readonly falseDenyRate: number;
  readonly isBaseline: boolean;
}

/**
 * hook 规则变异候选（元循环产出）。`patch` 为 mutator 产出的规则变更文本
 * （经 breaker precheck 通过）。只产候选集，不落盘——staging/active 写入由
 * commit 层（人审 gate）执行。
 */
export interface HookVariantCandidate {
  /** uuid */
  readonly id: string;
  /** baseline 规则集 sha256（变异父本） */
  readonly parentSha: string;
  /** 变异后的规则变更 patch 全文（breaker precheck 通过） */
  readonly patch: string;
  readonly provenance: {
    readonly trajectoryId: string;
    readonly mutatorSession: string;
    readonly generatedAt: number;
  };
}

/**
 * HookEvolutionDriver 构造 opts。
 *
 * `beamWidth`：beam-search 宽度（MVP 默认 3）。`mutator`/`sandbox` 必填。
 * `telemetry`/`agentSessionId` 为可选注入字段（与 T04a EvolutionDriver 同构）。
 */
export interface HookEvolutionDriverOptions {
  readonly beamWidth: number;
  readonly mutator: LlmMutator;
  readonly sandbox: SandboxExecutor;
  readonly telemetry?: TelemetrySink;
  /** agent 运行时 session id（mutator 须 ≠ 此值，防 self-critic 饱和） */
  readonly agentSessionId?: string;
}

// ── breaker precheck 纯函数 ─────────────────────────────────────────────────

/**
 * 从 mutator 产出的 patch 文本中抽取决策迁移 diff（tool / from / to）。
 *
 * 识别形如 `<forbidden-tool> ... <from> -> <to>` 或 `<from>→<to>` 的迁移片段
 * （大小写不敏感；tool 限 bash/write/edit——非 forbidden 工具的迁移不构成
 * breaker 违反，assertBreaker 内部亦会再判）。from/to 限 allow|deny|ask。
 */
const TRANSITION_RE =
  /\b(bash|write|edit)\b[\s\S]{0,200}?\b(allow|deny|ask)\s*(?:->|→)\s*(allow|deny|ask)\b/gi;

export function extractBreakerDiffs(patch: string): BreakerDiff[] {
  const out: BreakerDiff[] = [];
  for (const m of patch.matchAll(TRANSITION_RE)) {
    const tool = m[1];
    const from = m[2];
    const to = m[3];
    if (tool !== undefined && from !== undefined && to !== undefined) {
      out.push({ tool, from, to });
    }
  }
  return out;
}

/**
 * breaker precheck：对 patch 抽取的所有决策迁移跑 `HookPolicy.assertBreaker`。
 * 任一迁移把 bash/write/edit 从 deny/ask 放宽到 allow → 返回 false（候选 reject）。
 * 全部通过（收紧方向或非 forbidden 工具）→ 返回 true。
 *
 * 纯函数，便于复用与测试。
 */
export function hookBreakerPrecheck(patch: string): boolean {
  const policy = new HookPolicy();
  for (const diff of extractBreakerDiffs(patch)) {
    try {
      policy.assertBreaker(diff);
    } catch {
      // breaker 触发：deny/ask→allow 放宽 → 候选 reject
      return false;
    }
  }
  return true;
}

// ── select 纯函数 ───────────────────────────────────────────────────────────

/**
 * 双目标 strict-improvement 门（Pareto-vs-baseline 非支配）。
 *
 * 候选须 attackSuccessRate ≤ baseline 且 falseDenyRate ≤ baseline（两指标均不劣于
 * baseline），且至少一项严格更优。任一指标退化（candidate > baseline）→ false。
 * 不加权求和（PRD §6.7 多目标独立裁决）。
 */
export function hookStrictImprovementGate(
  candidate: HookCandidateScore,
  baseline: HookCandidateScore,
): boolean {
  const attackLe = candidate.attackSuccessRate <= baseline.attackSuccessRate;
  const falseDenyLe = candidate.falseDenyRate <= baseline.falseDenyRate;
  const atLeastOneStrict =
    candidate.attackSuccessRate < baseline.attackSuccessRate ||
    candidate.falseDenyRate < baseline.falseDenyRate;
  return attackLe && falseDenyLe && atLeastOneStrict;
}

// ── HookEvolutionDriver ────────────────────────────────────────────────────

/**
 * hook policy 进化驱动器：读失败 trajectory → 调 mutator reflective mutation
 * （沙箱内、独立 session）→ 产 ≤ beamWidth 个 `HookVariantCandidate`（经 breaker
 * precheck）。`select` 对 held-out 双指标跑 strict-improvement 门。
 *
 * 不落盘（spec「只产候选集」）；不暴露任何 policy 写入入口（agent 运行时绝对
 * 无写权，L0C-T11 只读强制）。
 */
export class HookEvolutionDriver {
  private readonly beamWidth: number;
  private readonly mutator: LlmMutator;
  private readonly sandbox: SandboxExecutor;
  private readonly telemetry: TelemetrySink | null;
  private readonly agentSessionId: string | null;
  private mutatorCounter = 0;

  constructor(opts: HookEvolutionDriverOptions) {
    this.beamWidth = opts.beamWidth;
    this.mutator = opts.mutator;
    this.sandbox = opts.sandbox;
    this.telemetry = opts.telemetry ?? null;
    this.agentSessionId = opts.agentSessionId ?? null;
  }

  /** 落一条遥测事件（telemetry 缺失时静默跳过）。 */
  private emit(event: Record<string, unknown>): void {
    this.telemetry?.write(event);
  }

  /**
   * 生成一个独立于 agent 运行时 session 的 mutator session id。
   * 防 self-critic 饱和（PRD §6.2/E2）与 prompt injection 持久化（R17）。
   */
  private nextMutatorSessionId(): string {
    this.mutatorCounter += 1;
    const sid = `hook-mutator-session-${process.pid}-${this.mutatorCounter}-${Date.now()}`;
    // 硬保证：mutatorSession ≠ agent 运行时 session
    if (this.agentSessionId !== null && sid === this.agentSessionId) {
      return `${sid}-distinct`;
    }
    return sid;
  }

  /**
   * 生成 ≤ beamWidth 个 hook 规则变异候选。
   *
   * - failures 为空 → 返回 `[]`（不强制生成）。
   * - mutator 调用失败 → 返回 `[]` + 落 `mutator_failed` 事件，不抛。
   * - 候选 patch 含 bash/write/edit 从 deny/ask 放宽到 allow 的 diff → breaker
   *   precheck reject（不进候选集）+ 落 `candidate_rejected_breaker` 事件。
   * - 每个候选 `provenance.mutatorSession` ≠ agentSessionId。
   */
  async generateHookCandidates(
    baseline: readonly HookRule[],
    failures: readonly FailureTrajectory[],
  ): Promise<HookVariantCandidate[]> {
    // 边界：失败 trajectory 为空 → 不强制生成
    if (failures.length === 0) {
      return [];
    }

    const parentSha = createHash("sha256")
      .update(JSON.stringify(baseline))
      .digest("hex");
    // baseline 序列化文本供 mutator reflective mutation（mutator 读 baseline 规则
    // + 失败 trajectory 生成 patch）。
    const baselineText = JSON.stringify(baseline);

    const candidates: HookVariantCandidate[] = [];
    const trajectoryId = failures[0]!.trajectoryId;

    for (let i = 0; i < this.beamWidth; i++) {
      const mutatorSession = this.nextMutatorSessionId();
      let patch: string;
      try {
        // mutator 在沙箱内、独立 session 执行（防 self-critic 饱和 + injection 持久化）
        patch = await this.sandbox.run(
          () => this.mutator.mutate(baselineText, [...failures]),
          { sessionId: mutatorSession },
        );
      } catch (err) {
        // 错误降级：mutator 不可用 → 返回空候选 + 落事件，不抛（离线批处理优雅降级）
        this.emit({
          event: "mutator_failed",
          substrate: "hook-policy",
          mutatorSession,
          error: err instanceof Error ? err.message : String(err),
          generatedCandidates: candidates.length,
        });
        return [];
      }

      // breaker precheck：bash/write/edit 从 deny/ask 放宽到 allow → reject
      if (!hookBreakerPrecheck(patch)) {
        this.emit({
          event: "candidate_rejected_breaker",
          substrate: "hook-policy",
          mutatorSession,
          reason:
            "breaker clause: bash/write/edit widened from deny/ask to allow (PRD §11.3)",
          generatedCandidates: candidates.length,
        });
        continue;
      }

      candidates.push({
        id: randomUUID(),
        parentSha,
        patch,
        provenance: {
          trajectoryId,
          mutatorSession,
          generatedAt: Date.now(),
        },
      });
    }

    return candidates;
  }

  /**
   * 双目标 strict-improvement select（AgentDojo attackSuccessRate↓ ∧ ASB
   * falseDenyRate↓）。
   *
   * 候选须在两指标上均不劣于 baseline 且至少一项严格更优（Pareto-vs-baseline
   * 非支配）。任一指标退化 → reject。`baseline` 作参照但不进输出。不加权求和
   * （PRD §6.7 多目标独立裁决）。
   */
  select(
    candidates: readonly HookCandidateScore[],
    baseline: HookCandidateScore,
  ): HookCandidateScore[] {
    return candidates.filter((c) => hookStrictImprovementGate(c, baseline));
  }
}
