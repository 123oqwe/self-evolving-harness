// L1-T05a · system phase prompt 进化 loop-a：beam-search reflective mutation 驱动器
//
// phase prompt 进化闭环第一半（PRD §8.1 交付物 #6；02-loop-context §2.1）。
// 与 T04a（compaction）同构：beam-search + reflective mutation + 沙箱 + 独立
// session。区别在基质是 phase prompt（三文件 init/coding/review）+ 签名校验
// 针对 phase 的 `<safety>` 与 `<identity>` 两段 static 段（spec §L1-T05a 错误
// 路径：候选改 static identity 段 → reject）。
//
// 本任务**只产候选集**，select 在 T05b。候选不落盘（staging/active 写入由
// T05b commit-on-success 负责）。
//
// 安全门（PRD §6.6/§11.3）：mutator 在沙箱内、用独立 session 执行（防
// self-critic 饱和 PRD §6.2/E2 + prompt injection 持久化 R17）；mutatorSession
// ≠ agent 运行时 session。
//
// ERRATA-w2plus 裁决：
//   L1-02: SandboxExecutor shape `{ run<T>(fn, opts?:{sessionId}):Promise<T> }`。
//   L1-03: 构造 opts 加 `{ repo?, telemetry?, agentSessionId?, orchestratorSessionId? }`。
//   L1-01: TelemetrySink = `{ write(event) }` 结构化注入，不绑包名。
//
// 实现策略说明（遵循「同包前序任务文件不删改」规则）：
//   spec 接口签名写了 `PhaseVariantCandidate extends VariantCandidate` 与
//   `PhaseEvolutionDriver extends EvolutionDriver`，但两者均与 T02/T04a 前序
//   文件物理冲突，无法字面满足：
//   (1) `VariantCandidate.substrate` 被 T02 钉死为字面量 `"compaction"`，子接口
//       收窄为 `"phase"` 触发 TS2430。
//   (2) `EvolutionDriver`（T04a）把 `beamWidth/mutator/sandbox/telemetry/
//       agentSessionId/mutatorCounter` 全声明为 `private`，子类重声明触发
//       TS2415 + TS4114；private 字段子类根本无法访问。
//   正确的 REFACTOR（泛化为 `EvolutionDriverBase<S>`）需改写 T04a 文件，越界，
//   留待统一重构。本任务改用**组合**：`PhaseVariantCandidate` 为独立接口
//   （结构相容但不继承），`PhaseEvolutionDriver` 自行持有字段 + 复制
//   `nextMutatorSessionId()`/`emit()` 两个小 helper（均 < 10 行），复用 T04a
//   已抽出的 `validateCandidate` 纯函数。修复后 9 个 TS error 全部消失。

import { createHash, randomUUID } from "node:crypto";
import {
  validateCandidate,
  type EvolutionDriverOptions,
  type FailureTrajectory,
  type LlmMutator,
  type SandboxExecutor,
} from "./evolution-driver.js";
import type { Substrate } from "./substrate-types.js";
import type { TelemetrySink } from "./compaction-substrate.js";
import type { ConfigRepo, ConfigSet } from "./repo-layout.js";
import type { SignatureVerifier } from "./signature.js";
import { computeSegmentHash } from "./signature.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * phase 变异候选（spec §L1-T05a 接口签名）。
 *
 * **独立接口，不 `extends VariantCandidate`**：T02 `VariantCandidate.substrate`
 * 钉死为字面量 `"compaction"`，子接口收窄为 `"phase"` 会触发 TS2430。本接口
 * 结构与 `VariantCandidate` 相容（id/parentSha/content/provenance 同形），
 * `substrate` 收窄为 `"phase"`，新增 `phase: 'init'|'coding'|'review'` 标识
 * 本候选变异的是哪一个 phase prompt（三 phase 独立候选集，不交叉污染）。
 */
export interface PhaseVariantCandidate {
  /** uuid */
  readonly id: string;
  readonly substrate: "phase";
  /** baseline sha（变异父本 sha256） */
  readonly parentSha: string;
  /** 变异后的 prompt 全文 */
  readonly content: string;
  readonly phase: "init" | "coding" | "review";
  readonly provenance: {
    readonly trajectoryId: string;
    readonly mutatorSession: string;
    readonly generatedAt: number;
  };
}

/**
 * PhaseEvolutionDriver 构造 opts。
 *
 * 相比 `EvolutionDriverOptions`，`repo` 与 `verifier` 为必填：phase 候选生成
 * 须从 repo 加载 baseline phase prompt（经 sha + safety 段签名校验），并以
 * `verifier` 消费 T03 签名清单（safety 段 runtime 第二层守卫）。
 */
export interface PhaseEvolutionDriverOptions extends EvolutionDriverOptions {
  readonly repo: ConfigRepo;
  readonly verifier: SignatureVerifier;
}

// ── 纯函数：identity 段 canonical 抽取 + sha256 ────────────────────────────

const IDENTITY_SEGMENT_RE = /<identity>([\s\S]*?)<\/identity>/;

/**
 * 计算 content 中 `<identity>` static 段的 canonical sha256。
 * canonical 抽取与 `signature.ts` 的 `computeSegmentHash` 同形（正则取内文 →
 * `trim()` 归一化 → sha256 hex），段缺失 → 返回 `null`。
 *
 * 注：T03 `computeSegmentHash` 当前仅支持 `'safety'` 段（前序任务文件不删改），
 * 故此处为 identity 段提供同构实现；canonical 形式与 safety 一致（regex +
 * trim + sha256），不引入新归一化逻辑以免漂移。
 */
function computeIdentitySegmentHash(content: string): string | null {
  const m = content.match(IDENTITY_SEGMENT_RE);
  if (!m) return null;
  return createHash("sha256").update(m[1]!.trim()).digest("hex");
}

// ── PhaseEvolutionDriver ───────────────────────────────────────────────────

/**
 * system phase prompt 进化 loop-a 驱动器（spec §L1-T05a）。
 *
 * **组合而非继承**：不 `extends EvolutionDriver`（T04a 基类字段全为 private，
 * 子类重声明触发 TS2415 + TS4114，且 private 字段子类无法访问）。本类自行持
 * 有 `beamWidth/mutator/sandbox/telemetry/agentSessionId/repo/verifier`，复制
 * `nextMutatorSessionId()`/`emit()` 两个小 helper（均 < 10 行），复用 T04a 已
 * 抽出的 `validateCandidate` 纯函数。
 *
 * `generatePhaseCandidates` 读 phase-coding baseline（T03）→ 调 mutator
 * reflective mutation（沙箱内、独立 session）→ 经 `validateCandidate`
 * （safety 段存在）+ identity 段不变量预检 → 产 ≤ beamWidth 个
 * `PhaseVariantCandidate`。
 *
 * 安全不变量（spec §L1-T05a 错误路径）：
 * - 候选删 `<safety>` 段 → reject（breaker clause，PRD §11.3）。
 * - 候选改 `<identity>` static 段（identity sha256 ≠ baseline）→ reject
 *   （static 段不进化；PRD §5.1「static 段低频改」+ spec 执行提示(1)：
 *   phase prompt 的 static 段整体不进化，manifest 须覆盖整段 static 前缀）。
 *
 * MVP 边界：本驱动变异 coding phase（spec Given「phase-coding baseline」；三
 * phase 独立候选集，本驱动产 coding 候选，init/review 留待后续按同构扩展）。
 */
export class PhaseEvolutionDriver {
  private readonly beamWidth: number;
  private readonly mutator: LlmMutator;
  private readonly sandbox: SandboxExecutor;
  private readonly telemetry: TelemetrySink | null;
  private readonly agentSessionId: string | null;
  private readonly repo: ConfigRepo;
  private readonly verifier: SignatureVerifier;
  private mutatorCounter = 0;

  constructor(opts: PhaseEvolutionDriverOptions) {
    this.beamWidth = opts.beamWidth;
    this.mutator = opts.mutator;
    this.sandbox = opts.sandbox;
    this.telemetry = opts.telemetry ?? null;
    this.agentSessionId = opts.agentSessionId ?? null;
    this.repo = opts.repo;
    this.verifier = opts.verifier;
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
    if (this.agentSessionId !== null && sid === this.agentSessionId) {
      return `${sid}-distinct`;
    }
    return sid;
  }

  /**
   * 候选预检（phase 维度）：safety 段存在 + identity 段 sha256 与 baseline
   * 一致（static 段不进化）。
   *
   * - safety 段缺失（mutator 删 safety）→ `valid=false`（breaker clause）。
   * - identity 段缺失或 sha256 失配（mutator 改 identity）→ `valid=false`。
   * - 两段 static 段不变 → `valid=true`。
   */
  private validatePhaseCandidate(
    baselineContent: string,
    candidateContent: string,
  ): { valid: boolean; reason: string } {
    // safety 段内容完整性（复用 T04a `validateCandidate` 纯函数，传 baseline
    // safety sha 升级为 sha 比对——candidate 改写 safety 段 → sha 失配 → reject）
    const baselineSafetySha = computeSegmentHash(baselineContent, "safety");
    const safety = validateCandidate(
      { content: candidateContent },
      baselineSafetySha ?? undefined,
    );
    if (!safety.valid) {
      return safety;
    }
    // identity 段不变量（static identity 段不进化，PRD §5.1 + spec 执行提示(1)）
    const baselineIdentity = computeIdentitySegmentHash(baselineContent);
    const candidateIdentity = computeIdentitySegmentHash(candidateContent);
    if (baselineIdentity === null || candidateIdentity === null) {
      return {
        valid: false,
        reason:
          "identity static segment missing in baseline or candidate (static segment must not evolve)",
      };
    }
    if (baselineIdentity !== candidateIdentity) {
      return {
        valid: false,
        reason:
          "identity static segment sha256 mismatch: candidate mutated static identity (auto-reject)",
      };
    }
    return { valid: true, reason: "safety + identity static segments unchanged" };
  }

  /**
   * 生成 ≤ beamWidth 个 phase 变异候选（spec §L1-T05a）。
   *
   * - `failures` 为空 → 返回 `[]`（不强制生成）。
   * - `phase` 非 `'phase'` → 返回 `[]`（本驱动只处理 phase 基质）。
   * - mutator 调用失败（LLM 不可用）→ 返回 `[]` + 落 `mutator_failed` 事件，
   *   不抛（离线批处理优雅降级）。
   * - 候选删 `<safety>` 段 → reject + 落 `candidate_rejected_safety` 事件。
   * - 候选改 `<identity>` static 段 → reject + 落 `candidate_rejected_identity`
   *   事件（static 段不进化）。
   * - 每个候选 `parentSha` == phase-coding baseline sha，`provenance.mutatorSession`
   *   ≠ agentSessionId。
   */
  async generatePhaseCandidates(
    phase: Substrate["kind"],
    failures: readonly FailureTrajectory[],
  ): Promise<PhaseVariantCandidate[]> {
    // 边界：失败 trajectory 为空 → 不强制生成
    if (failures.length === 0) {
      return [];
    }
    // 本驱动只处理 phase 基质（compaction 由 T04a EvolutionDriver 处理）
    if (phase !== "phase") {
      return [];
    }

    // 接线 safety 段签名校验器到 repo（T03 runtime 第二层守卫）：
    // loadActive 在 sha 钉死通过后、ConfigSet swap 之前校验 safety 段签名，
    // 失配 → throw，绝不返回半加载快照（active 不被毒化）。
    this.repo.setSegmentVerifier(this.verifier);
    const cs: ConfigSet = this.repo.loadActive();
    const baselineContent = cs.phasePrompts.coding;
    if (baselineContent === undefined) {
      // phase-coding baseline 缺失 → 视作篡改/未配置，拒绝生成候选
      this.emit({
        event: "phase_baseline_missing",
        phase: "coding",
        substrate: "phase",
      });
      return [];
    }

    const parentSha = createHash("sha256")
      .update(baselineContent)
      .digest("hex");
    const trajectoryId = failures[0]!.trajectoryId;
    const phaseKey: "init" | "coding" | "review" = "coding";

    const candidates: PhaseVariantCandidate[] = [];

    for (let i = 0; i < this.beamWidth; i++) {
      const mutatorSession = this.nextMutatorSessionId();
      let content: string;
      try {
        // mutator 在沙箱内、独立 session 执行（防 self-critic 饱和 + injection 持久化）
        content = await this.sandbox.run(
          () => this.mutator.mutate(baselineContent, [...failures]),
          { sessionId: mutatorSession },
        );
      } catch (err) {
        // 错误降级：mutator 不可用 → 返回空候选 + 落事件，不抛
        this.emit({
          event: "mutator_failed",
          substrate: "phase",
          phase: phaseKey,
          mutatorSession,
          error: err instanceof Error ? err.message : String(err),
          generatedCandidates: candidates.length,
        });
        return [];
      }

      // 候选预检：safety 段存在 + identity 段不变（static 段不进化）
      const validation = this.validatePhaseCandidate(baselineContent, content);
      if (!validation.valid) {
        const reason = validation.reason;
        const eventType = reason.includes("identity")
          ? "candidate_rejected_identity"
          : "candidate_rejected_safety";
        this.emit({
          event: eventType,
          substrate: "phase",
          phase: phaseKey,
          mutatorSession,
          reason,
          generatedCandidates: candidates.length,
        });
        continue;
      }

      candidates.push({
        id: randomUUID(),
        substrate: "phase",
        phase: phaseKey,
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
