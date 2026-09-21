// L1-T04a · compaction prompt 进化 loop-a：beam-search reflective mutation 驱动器
//
// 进化闭环第一半——生成变异候选（PRD §8.1 交付物 #5；02-loop-context §1.4b(d)
// generate）。MVP 用 GEPA 降配版 beam-search（宽 B=beamWidth，默认 3）+ reflective
// mutation（mutator 读失败 trajectory 生成 patch）。本任务**只产候选集**，打分与
// select 在 T04b（spec §L1-T04a 明示：「本任务只产候选集，打分与 select 在 T04b」）。
//
// 安全门（PRD §6.6/§11.3）：mutator 在沙箱内、用独立 session 执行（防 self-critic
// 饱和 PRD §6.2/E2 + prompt injection 持久化 R17）；mutatorSession ≠ agent 运行时
// session。每个候选经 `validateCandidate` 预检 safety 段存在——删 `<safety>` 段的
// 候选被 reject，不进候选集，记一条 `candidate_rejected_safety` 事件。
//
// 错误降级：mutator 调用失败（LLM 不可用）→ 返回空候选 + 落 `mutator_failed` 事件，
// 不抛（进化是离线批处理，失败优雅降级）。失败 trajectory 为空 → 返回空候选（不强制
// 生成）。
//
// ERRATA-w2plus 裁决：
//   L1-02: SandboxExecutor shape `{ run<T>(fn, opts?:{sessionId}):Promise<T> }`。
//   L1-03: 构造 opts 加 `{ repo?, telemetry?, agentSessionId?, orchestratorSessionId? }`。
//   L1-01: TelemetrySink = `{ write(event) }` 结构化注入，不绑包名。

import { createHash, randomUUID } from "node:crypto";
import { computeSegmentHash } from "./signature.js";
import type { Substrate } from "./substrate-types.js";
// 遥测 sink 复用 compaction-substrate.ts 的 TelemetrySink（ERRATA-w2plus L1-01：
// re-export TranscriptWriter shape `{ write(event) }`，结构化注入 opts.telemetry，
// 不绑包名）。可选——缺失时静默跳过事件落盘。
import type { TelemetrySink } from "./compaction-substrate.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * 失败 trajectory（Clio-style 失败簇摘要 + recall 信号）。
 * mutator 读它做 reflective mutation（「丢了 X 导致重读」→ 生成 patch）。
 */
export interface FailureTrajectory {
  readonly trajectoryId: string;
  /** Clio-style 失败簇摘要 */
  readonly failureSummary: string;
  /** recall 信号：被 summarize 掉的工具输出在 compaction 后被重读的次数（>0 表 recall 退化） */
  readonly rereadCount: number;
}

/**
 * LLM reflective mutation 接口（对接 L3-T03 reflective mutation 生成器；未就绪时用 stub）。
 * mutator 读 baseline prompt + 失败 trajectory，反思后返回变异后的 prompt 全文。
 */
export interface LlmMutator {
  mutate(prompt: string, failures: FailureTrajectory[]): Promise<string>;
}

/**
 * 沙箱执行器（L0S-T02 提供；ERRATA-w2plus L1-02 shape）。
 * `run` 内捕获 `opts.sessionId` 供调用方验证 mutator 独立 session。
 */
export interface SandboxExecutor {
  run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>;
}

// (TelemetrySink 类型见上方 import，复用 compaction-substrate.ts 定义)

// ── 候选预检纯函数 ─────────────────────────────────────────────────────────

/**
 * 候选预检结果。
 * - `valid=true`：候选保留 safety 段，可入候选集。
 * - `valid=false`：候选删了 `<safety>` 段（视作篡改），reject；`reason` 含上下文。
 */
export interface CandidateValidation {
  readonly valid: boolean;
  readonly reason: string;
}

/**
 * 候选预检纯函数（spec §L1-T04a REFACTOR：抽成 `validateCandidate` 供 T04b select
 * 前、T05a 复用）。
 *
 * 校验：candidate.content 须保留合法 `<safety>...</safety>` 段（canonical 抽取 +
 * sha256 与 T03 `computeSegmentHash` 共用同一实现，避免双份逻辑漂移）。
 *
 * - 段缺失（被 mutator 删除）→ `valid=false`，视作 breaker clause 触发
 *   （PRD §11.3：删 safety rule 的 diff 自动 reject）。
 * - 段存在但 sha256 与 `expectedSafetySha` 失配（mutator **改写** safety 段弱化
 *   规则，而非删除）→ `valid=false`（breaker clause 同样覆盖「改」：删被拦，
 *   内容弱化亦被拦）。`expectedSafetySha` 缺省时退化为仅 presence 校验
 *   （向后兼容 T01 单基质 / 未接线 manifest 场景）；一旦调用方传入 baseline/
 *   manifest 的 safety 段 sha，即升级为内容完整性门。
 *
 * 注：完整的 L0C-T08 `checkDiff` 危险 diff 检查（deny→allow / static-core field 删除
 * 等）由 pre-commit 层在 commit-on-success（T04b）时执行；本任务只产候选集不落盘，
 * 故本预检聚焦 safety 段内容完整性这一最关键安全不变量。
 */
export function validateCandidate(
  candidate: {
    readonly content: string;
  },
  expectedSafetySha?: string,
): CandidateValidation {
  const hash = computeSegmentHash(candidate.content, "safety");
  if (hash === null) {
    return {
      valid: false,
      reason:
        "safety segment deleted/missing in candidate (breaker clause: auto-reject)",
    };
  }
  if (expectedSafetySha !== undefined && hash !== expectedSafetySha) {
    return {
      valid: false,
      reason:
        "safety segment sha256 mismatch: candidate rewrote safety content " +
        "(breaker clause: auto-reject; PRD §11.3 covers delete AND weaken)",
    };
  }
  return { valid: true, reason: "safety segment present" };
}

// ── EvolutionDriver ────────────────────────────────────────────────────────

/**
 * EvolutionDriver 构造 opts。
 *
 * `beamWidth`：beam-search 宽度（MVP 默认 3）。`mutator`/`sandbox` 必填。
 * ERRATA-w2plus L1-03：`repo`/`telemetry`/`agentSessionId`/`orchestratorSessionId`
 * 为可选注入字段。
 */
export interface EvolutionDriverOptions {
  readonly beamWidth: number;
  readonly mutator: LlmMutator;
  readonly sandbox: SandboxExecutor;
  readonly repo?: unknown;
  readonly telemetry?: TelemetrySink;
  /** agent 运行时 session id（mutator 须 ≠ 此值，防 self-critic 饱和） */
  readonly agentSessionId?: string;
  readonly orchestratorSessionId?: string;
}

/**
 * compaction prompt 进化 loop-a 驱动器：读失败 trajectory → 调 mutator reflective
 * mutation（沙箱内、独立 session）→ 产 ≤ beamWidth 个 `VariantCandidate`。
 *
 * 不落盘（spec「只产候选集」）；staging/active 写入由 T04b commit-on-success 负责。
 */
export class EvolutionDriver {
  private readonly beamWidth: number;
  private readonly mutator: LlmMutator;
  private readonly sandbox: SandboxExecutor;
  private readonly telemetry: TelemetrySink | null;
  private readonly agentSessionId: string | null;
  private mutatorCounter = 0;

  constructor(opts: EvolutionDriverOptions) {
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
    const sid = `mutator-session-${process.pid}-${this.mutatorCounter}-${Date.now()}`;
    // 硬保证：mutatorSession ≠ agent 运行时 session
    if (this.agentSessionId !== null && sid === this.agentSessionId) {
      return `${sid}-distinct`;
    }
    return sid;
  }

  /**
   * 生成 ≤ beamWidth 个变异候选。
   *
   * - failures 为空 → 返回 `[]`（不强制生成）。
   * - mutator 调用失败 → 返回 `[]` + 落 `mutator_failed` 事件，不抛。
   * - 候选删 `<safety>` 段 → reject（不进候选集）+ 落 `candidate_rejected_safety` 事件。
   * - 每个候选 `parentSha` == baseline sha，`provenance.mutatorSession` ≠ agentSessionId。
   */
  async generateCandidates(
    substrate: Substrate,
    failures: readonly FailureTrajectory[],
  ): Promise<import("./substrate-types.js").VariantCandidate[]> {
    // 边界：失败 trajectory 为空 → 不强制生成
    if (failures.length === 0) {
      return [];
    }

    const parentSha = createHash("sha256")
      .update(substrate.content)
      .digest("hex");
    // baseline safety 段 sha——供 validateCandidate 升级为内容完整性门
    // （candidate 改写 safety 段内容 → sha 失配 → reject，PRD §11.3 breaker clause）。
    // baseline 无 safety 段时（未配置）传 undefined 退化为仅 presence 校验。
    const baselineSafetySha = computeSegmentHash(substrate.content, "safety") ?? undefined;

    const candidates: import("./substrate-types.js").VariantCandidate[] = [];
    // 取首条失败 trajectory 作为 provenance.trajectoryId（多条时取首条代表）
    const trajectoryId = failures[0]!.trajectoryId;

    for (let i = 0; i < this.beamWidth; i++) {
      const mutatorSession = this.nextMutatorSessionId();
      let content: string;
      try {
        // mutator 在沙箱内、独立 session 执行（防 self-critic 饱和 + injection 持久化）
        content = await this.sandbox.run(
          () => this.mutator.mutate(substrate.content, [...failures]),
          { sessionId: mutatorSession },
        );
      } catch (err) {
        // 错误降级：mutator 不可用 → 返回空候选 + 落事件，不抛（离线批处理优雅降级）
        this.emit({
          event: "mutator_failed",
          substrate: substrate.kind,
          mutatorSession,
          error: err instanceof Error ? err.message : String(err),
          generatedCandidates: candidates.length,
        });
        return [];
      }

      // 候选预检：safety 段内容完整性（删/改 safety → breaker clause 自动 reject）
      const validation = validateCandidate({ content }, baselineSafetySha);
      if (!validation.valid) {
        this.emit({
          event: "candidate_rejected_safety",
          substrate: substrate.kind,
          mutatorSession,
          reason: validation.reason,
          generatedCandidates: candidates.length,
        });
        continue;
      }

      candidates.push({
        id: randomUUID(),
        substrate: "compaction",
        parentSha,
        content,
        provenance: {
          trajectoryId,
          mutatorSession,
          generatedAt: Date.now(),
        },
      });
    }

    return candidates;
  }
}
