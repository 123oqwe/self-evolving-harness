// L1-T07 · tool description/field-doc 进化 loop（ExpeL + TextGrad；selection ∧ resolve
// 联合；schema 形状锁；贬抑语 flag）
//
// Spec: execution/L1-config/TASKS.md §L1-T07。
//
// 工具 description 进化闭环（PRD §8.2 交付物 #5；02-loop-context §2.2(d)）。
// generate 用 ExpeL insight（从「选错工具」trajectory 提区分要点）+ TextGrad 风格
// textual gradient（对选错 trajectory 的 critique 回传 description）。score =
// selection-accuracy ∧ resolve 联合 + description token 税。schema 形状锁 + 贬抑语
// flag 作安全门。
//
// - generateToolCandidates：调 mutator（沙箱内、独立 session）产 descriptionPatch；
//   每个候选经 `assertShapeLocked`（复用 T06）+ 贬抑语扫描；改 schema 形状字段或含
//   贬抑语 → 不进候选集（不进 staging）。name 不可变（static-core）。
// - select：selection ∧ resolve 作 strict-improvement 硬约束（任一退化 ≥ τ → reject）；
//   descriptionTokens 作软目标（Pareto 最小化，select 阶段不据此硬 reject——只在
//   Pareto 排序时纳入，防 reward hacking 退化为单看选中率）。
// - commitOnSuccess：候选过门才写 `tools/registry/<tool>.yaml` active + staging 版本
//   后缀；改 schema 形状 → throw + `candidate_rejected_shape` 事件（不触盘）。
//
// 实现策略（遵循「同包前序任务文件不删改」规则）：T04a `EvolutionDriver`/T04b
// `SelectRetain`/T02 `VariantCandidate` 均钉死 compaction 形状（substrate:"compaction"
// 字面量 + recall/resolveRate/cacheHit 三指标），与 tool 维度形状不同（substrate:"tool"
// + selectionAccuracy/resolveRate/descriptionTokens）。子接口收窄 substrate 字面量
// 触发 TS2430；`EvolutionDriver` private 字段子类无法访问（TS2415/TS4114）。故与
// T05a/T05b 同构——另起 `tool-evolution.ts`，`ToolVariantCandidate` 为独立接口（结构
// 相容但不继承），`ToolEvolutionDriver`/`ToolSelectRetain` 自行持有字段 + 复用 T06
// 已抽出的 `assertShapeLocked`/`detectDisparagement` 纯函数。REFACTOR 留待统一抽象
// `<S extends Substrate>` 泛化（spec §L1-T07 REFACTOR）。
//
// ERRATA-w2plus 裁决：
//   L1-02: SandboxExecutor shape `{ run<T>(fn, opts?:{sessionId}):Promise<T> }`。
//   L1-03: 构造 opts 加 `{ repo?, telemetry?, agentSessionId?, orchestratorSessionId? }`。
//   L1-01: TelemetrySink = `{ write(event) }` 结构化注入，不绑包名。
//   形状基准持久化位置 = 外部注入 `opts.baselineShape`（shape-manifest.json 钉死版本）。

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
import type { TelemetrySink } from "./compaction-substrate.js";
import type { LlmMutator, SandboxExecutor, FailureTrajectory } from "./evolution-driver.js";
// 复用 T06 已抽出的纯函数：schema 形状锁 + 贬抑语扫描（不重复实现，防漂移）。
import {
  assertShapeLocked,
  detectDisparagement,
  type BaselineShape,
  type ToolDoc,
} from "./tool-registry.js";

// re-export 公共类型供消费方（测试 / driver）使用
export type { BaselineShape, ToolDoc } from "./tool-registry.js";
export type { LlmMutator, SandboxExecutor, FailureTrajectory } from "./evolution-driver.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * tool 变异候选（spec §L1-T07 接口签名）。
 *
 * **独立接口，不 `extends VariantCandidate`**：T02 `VariantCandidate.substrate` 钉死
 * 为字面量 `"compaction"`，子接口收窄为 `"tool"` 触发 TS2430。本接口结构与
 * `VariantCandidate` 相容（id/parentSha/content/provenance 同形），`substrate` 收窄
 * 为 `"tool"`，新增 `toolName`（name 不变，static-core）+ `descriptionPatch`（仅
 * description/field-doc/examples 可变的变异产物）。
 */
export interface ToolVariantCandidate {
  /** uuid */
  readonly id: string;
  readonly substrate: "tool";
  /** 工具名（static-core，不可变——MCP 契约 + pi 重名键） */
  readonly toolName: string;
  /** 变异后的 description/field-doc/examples 文本（不改 name/schema 形状字段） */
  readonly descriptionPatch: string;
  /** baseline sha（变异父本 sha256） */
  readonly parentSha: string;
  /** 变异后的 registry YAML 全文（commit-on-success 写 active） */
  readonly content: string;
  readonly provenance: {
    readonly trajectoryId: string;
    readonly mutatorSession: string;
    readonly generatedAt: number;
  };
}

/**
 * tool 候选打分（held-out 评测产出）。
 *
 * - `selectionAccuracy`：第一步选对率，越高越好（**硬**约束——防 description 进化
 *   「骗」模型选某工具，02-loop-context §2.2 reward hacking 风险）。
 * - `resolveRate`：选对后 resolve 率（联合信号），越高越好（**硬**约束——单看选中率
 *   会让 description 退化为「骗选中」，selection ∧ resolve 联合是防 reward hacking
 *   的核心）。
 * - `descriptionTokens`：description token 税，越低越好（**软**目标——Pareto 最小化，
 *   select 阶段不据此硬 reject；token 略增但 selection∧resolve 改善仍入选）。
 * - `isBaseline`：标记基线分数（select 时作参照，不进候选输出）。
 */
export interface ToolCandidateScore {
  readonly candidateId: string;
  readonly selectionAccuracy: number;
  readonly resolveRate: number;
  readonly descriptionTokens: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * retain 退化门拒绝（fail-closed）。候选在 tool strict-improvement 硬门
 * （selection ∧ resolve）上失败 → `commitOnSuccess` 抛此错并**不触盘**。
 * 对照 L3 `Retain.commit` 的 fail-closed 守卫。
 */
export class ToolRetainGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRetainGateError";
  }
}

/** tool strict-improvement 门默认退化容忍阈值 τ（与 T04b/T05b 一致）。 */
const DEFAULT_TOOL_TAU = 0.02;

/** registry 文件根目录（相对 repo root，posix）。 */
const REGISTRY_DIR = "tools/registry";
const TOOL_STAGING_DIR = "staging";

const SHAPE_REJECT_EVENT = "candidate_rejected_shape";
const DISPARAGEMENT_EVENT = "candidate_rejected_disparagement";
const MUTATOR_FAILED_EVENT = "mutator_failed";

// ── 极简 YAML 抽取（registry 形状子集，只读所需字段） ───────────────────────
//
// 无外部依赖（禁新依赖）。registry YAML 形状简单（顶层 mapping + inputSchema
// 子块 + fieldDoc 子块 + examples 序列）。此处只需抽取 `description` 与
// `inputSchema.{types,required,enum}` 三组形状键，不解析全树——避免与 T06
// `parseYaml` 重复实现全量解析（T06 `parseYaml` 为模块私有不可导入，且本任务
// 形状锁只需子集）。

function parseInline(value: string): unknown {
  const v = value.trim();
  if (v === "") return null;
  if (v.startsWith("[") || v.startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function toStringArray(v: unknown): readonly string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

/**
 * 从 registry YAML 全文抽取 inputSchema 形状键（types/required/enum）。
 * 供形状锁比对（commitOnSuccess / generateToolCandidates 候选预检）。
 */
function extractInputSchemaShape(content: string): {
  readonly types: readonly string[];
  readonly required: readonly string[];
  readonly enum: Readonly<Record<string, readonly string[]>>;
} {
  const lines = content.split(/\r?\n/);
  let inInputSchema = false;
  let blockIndent = -1;
  let types: readonly string[] = [];
  let required: readonly string[] = [];
  let enumVal: Readonly<Record<string, readonly string[]>> = {};
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let indent = 0;
    while (raw[indent] === " ") indent++;
    const text = raw.slice(indent);
    if (indent === 0) {
      // 顶层键：进入 inputSchema 块或退出
      if (text.startsWith("inputSchema:")) {
        inInputSchema = true;
        blockIndent = -1; // 子行缩进待定
      } else {
        inInputSchema = false;
      }
      continue;
    }
    if (!inInputSchema) continue;
    // inputSchema 子块第一行确定 blockIndent
    if (blockIndent < 0) blockIndent = indent;
    if (indent < blockIndent) {
      // 离开 inputSchema 块
      inInputSchema = false;
      continue;
    }
    const colonIdx = text.indexOf(":");
    if (colonIdx === -1) continue;
    const key = text.slice(0, colonIdx).trim();
    const rest = text.slice(colonIdx + 1).trim();
    if (key === "types") {
      types = toStringArray(parseInline(rest));
    } else if (key === "required") {
      required = toStringArray(parseInline(rest));
    } else if (key === "enum") {
      const parsed = parseInline(rest);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        enumVal = parsed as Record<string, readonly string[]>;
      }
    }
  }
  return { types, required, enum: enumVal };
}

/**
 * 从 registry YAML 全文抽取 `description` 字段（顶层标量）。
 * 供贬抑语扫描（generateToolCandidates 候选预检）。
 */
function extractDescription(content: string): string {
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let indent = 0;
    while (raw[indent] === " ") indent++;
    if (indent !== 0) continue; // 只取顶层 description
    const text = raw.slice(indent);
    if (text.startsWith("description:")) {
      const rest = text.slice("description:".length).trim();
      const v = parseInline(rest);
      return v === null ? "" : String(v);
    }
  }
  return "";
}

// ── ToolEvolutionDriver ────────────────────────────────────────────────────

/**
 * ToolEvolutionDriver 构造 opts。
 *
 * `beamWidth`：beam-search 宽度（MVP 默认 3）。`mutator`/`sandbox` 必填。
 * `repo`：ConfigRepo（commit-on-success 写 active + staging；generate 阶段不触盘）。
 * `baselineShape`：钉死版本 inputSchema 形状键（shape-manifest.json），候选预检
 * 形状锁比对基准。ERRATA-w2plus 风格：opts 结构化注入。
 */
export interface ToolEvolutionDriverOptions {
  readonly beamWidth: number;
  readonly mutator: LlmMutator;
  readonly sandbox: SandboxExecutor;
  readonly repo?: ConfigRepo;
  readonly telemetry?: TelemetrySink;
  /** agent 运行时 session id（mutator 须 ≠ 此值，防 self-critic 饱和） */
  readonly agentSessionId?: string;
  readonly orchestratorSessionId?: string;
  readonly baselineShape?: BaselineShape;
}

/**
 * tool description 进化 loop-a 驱动器：读失败 trajectory → 调 mutator reflective
 * mutation（沙箱内、独立 session）→ 经 `assertShapeLocked` + 贬抑语扫描预检 →
 * 产 ≤ beamWidth 个 `ToolVariantCandidate`。
 *
 * 不落盘（spec「只产候选集」）；staging/active 写入由 `ToolSelectRetain.commitOnSuccess`
 * 负责。
 *
 * 安全不变量（spec §L1-T07 错误路径）：
 * - 候选改 schema 形状字段（types/required/enum）→ reject（不进候选集）+ 落
 *   `candidate_rejected_shape` 事件。
 * - 候选 description 含贬抑语 → flag + 不进 staging（不进候选集）+ 落
 *   `candidate_rejected_disparagement` 事件（区分「告警」与「reject」两级：T06
 *   load 时贬抑语仅告警不阻塞，本任务进化时贬抑语阻塞进 staging）。
 * - mutator 在沙箱内、独立 session 执行（mutatorSession ≠ agent 运行时 session）。
 * - `toolName` 恒等于 baseline `tool.name`（name 不可变，static-core）。
 */
export class ToolEvolutionDriver {
  private readonly beamWidth: number;
  private readonly mutator: LlmMutator;
  private readonly sandbox: SandboxExecutor;
  private readonly telemetry: TelemetrySink | null;
  private readonly agentSessionId: string | null;
  private readonly repo: ConfigRepo | undefined;
  private readonly baselineShape: BaselineShape | undefined;
  private mutatorCounter = 0;

  constructor(opts: ToolEvolutionDriverOptions) {
    this.beamWidth = opts.beamWidth;
    this.mutator = opts.mutator;
    this.sandbox = opts.sandbox;
    this.telemetry = opts.telemetry ?? null;
    this.agentSessionId = opts.agentSessionId ?? null;
    this.repo = opts.repo;
    this.baselineShape = opts.baselineShape;
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
   * 候选预检（tool 维度）：schema 形状锁 + 贬抑语扫描。
   *
   * - 形状锁：候选 inputSchema 形状键（types/required/enum）须与 `baselineShape`
   *   逐键深度相等（复用 T06 `assertShapeLocked`）。失配 → `valid=false`，reject。
   *   `baselineShape` 缺省时跳过形状锁校验。
   * - 贬抑语：候选 description 须不含贬抑语关键词（复用 T06 `detectDisparagement`）。
   *   命中 → `valid=false`，flag + 不进 staging（区分 T06 load 时仅告警）。
   *
   * @returns `{valid, reason, kind}` —— `kind` 标识 reject 类别（shape/disparagement），
   *   供遥测事件 type 选用。
   */
  private validateToolCandidate(content: string): {
    valid: boolean;
    reason: string;
    kind: "shape" | "disparagement" | null;
  } {
    // 贬抑语扫描（description 维度）
    const description = extractDescription(content);
    const hits = detectDisparagement(description);
    if (hits.length > 0) {
      return {
        valid: false,
        reason: `disparagement terms detected in description: ${hits.join(", ")}`,
        kind: "disparagement",
      };
    }
    // schema 形状锁（types/required/enum 逐键深度相等）
    if (this.baselineShape) {
      const manifest = extractInputSchemaShape(content);
      try {
        assertShapeLocked("tool", manifest, this.baselineShape);
      } catch (err) {
        return {
          valid: false,
          reason: err instanceof Error ? err.message : String(err),
          kind: "shape",
        };
      }
    }
    return { valid: true, reason: "shape locked + no disparagement", kind: null };
  }

  /**
   * 生成 ≤ beamWidth 个 tool 变异候选（spec §L1-T07）。
   *
   * - `failures` 为空 → 返回 `[]`（不强制生成）。
   * - mutator 调用失败（LLM 不可用）→ 返回 `[]` + 落 `mutator_failed` 事件，不抛
   *   （离线批处理优雅降级）。
   * - 候选改 schema 形状字段 → reject（不进候选集）+ 落 `candidate_rejected_shape`
   *   事件。
   * - 候选 description 含贬抑语 → flag + 不进 staging（不进候选集）+ 落
   *   `candidate_rejected_disparagement` 事件。
   * - 每个候选 `toolName` 恒等于 `tool.name`（name 不可变，static-core），
   *   `provenance.mutatorSession` ≠ agentSessionId。
   */
  async generateToolCandidates(
    tool: ToolDoc,
    failures: readonly FailureTrajectory[],
  ): Promise<ToolVariantCandidate[]> {
    // 边界：失败 trajectory 为空 → 不强制生成
    if (failures.length === 0) {
      return [];
    }

    const baselineText = tool.description;
    const parentSha = createHash("sha256").update(baselineText).digest("hex");
    const trajectoryId = failures[0]!.trajectoryId;
    const candidates: ToolVariantCandidate[] = [];

    for (let i = 0; i < this.beamWidth; i++) {
      const mutatorSession = this.nextMutatorSessionId();
      let content: string;
      try {
        // mutator 在沙箱内、独立 session 执行（防 self-critic 饱和 + injection 持久化）
        content = await this.sandbox.run(
          () => this.mutator.mutate(baselineText, [...failures]),
          { sessionId: mutatorSession },
        );
      } catch (err) {
        // 错误降级：mutator 不可用 → 返回空候选 + 落事件，不抛
        this.emit({
          event: MUTATOR_FAILED_EVENT,
          substrate: "tool",
          toolName: tool.name,
          mutatorSession,
          error: err instanceof Error ? err.message : String(err),
          generatedCandidates: candidates.length,
        });
        return [];
      }

      // 候选预检：schema 形状锁 + 贬抑语扫描
      const validation = this.validateToolCandidate(content);
      if (!validation.valid) {
        const eventType =
          validation.kind === "disparagement"
            ? DISPARAGEMENT_EVENT
            : SHAPE_REJECT_EVENT;
        this.emit({
          event: eventType,
          substrate: "tool",
          toolName: tool.name,
          mutatorSession,
          reason: validation.reason,
          generatedCandidates: candidates.length,
        });
        continue;
      }

      candidates.push({
        id: randomUUID(),
        substrate: "tool",
        toolName: tool.name,
        descriptionPatch: content,
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

// ── ToolSelectRetain ───────────────────────────────────────────────────────

/**
 * ToolSelectRetain 构造 opts。
 *
 * `repo`：ConfigRepo（commit-on-success 写 active + staging + pinSha）。`select`
 * 为纯函数无 IO，repo 可选（仅 select 调用时可不传）。`telemetry`：shape reject
 * 事件落盘。`baselineShape`：commit-on-success 形状锁比对基准。
 */
export interface ToolSelectRetainOptions {
  readonly repo?: ConfigRepo;
  readonly telemetry?: TelemetrySink;
  readonly baselineShape?: BaselineShape;
}

/**
 * tool 进化 loop-b：strict-improvement（selection ∧ resolve 硬约束）+ Pareto
 * （descriptionTokens 软目标，最小化损失不硬=不降）+ commit-on-success retain。
 *
 * `select` 为纯函数无 IO；`commitOnSuccess` 触盘（写 active + staging 版本后缀 +
 * pinSha 重锁）。形状锁失败 → throw + `candidate_rejected_shape` 事件（不触盘）。
 */
export class ToolSelectRetain {
  private readonly repo: ConfigRepo | undefined;
  private readonly telemetry: TelemetrySink | null;
  private readonly baselineShape: BaselineShape | undefined;

  constructor(opts: ToolSelectRetainOptions) {
    this.repo = opts.repo;
    this.telemetry = opts.telemetry ?? null;
    this.baselineShape = opts.baselineShape;
  }

  private emit(event: Record<string, unknown>): void {
    this.telemetry?.write(event);
  }

  /**
   * select：候选须同时过 selection ∧ resolve 硬约束（任一退化 ≥ τ → reject，
   * 防 reward hacking 退化为单看选中率——selection ∧ resolve 联合是核心）。
   * descriptionTokens 作软目标——select 阶段不据此硬 reject（Pareto 最小化损失，
   * token 略增但 selection∧resolve 改善仍入选；spec §L1-T07：「selection ∧ resolve
   * 作 strict-improvement 硬约束；descriptionTokens 作软目标（Pareto 最小化）」）。
   *
   * 纯函数无 IO，便于 canary 对抗场景复用。
   */
  select(
    candidates: ToolCandidateScore[],
    baseline: ToolCandidateScore,
    tau: number,
  ): ToolCandidateScore[] {
    return candidates.filter((c) => {
      // selectionAccuracy：越高越好；退化 = baseline - candidate >= tau → reject
      if (baseline.selectionAccuracy - c.selectionAccuracy >= tau) return false;
      // resolveRate：越高越好；退化 = baseline - candidate >= tau → reject（联合硬约束）
      if (baseline.resolveRate - c.resolveRate >= tau) return false;
      // descriptionTokens：软目标，select 阶段不硬 reject（Pareto 最小化）
      return true;
    });
  }

  /**
   * fail-closed 退化门裁决（commitOnSuccess 前置）。从 `scores` 抽取基线
   * （`isBaseline===true`）与候选分数集，复用 `select` 的硬约束门：任一候选
   * 未过门 → 抛 `ToolRetainGateError`（不触盘）。仅基线无候选时不裁决（向后兼容）。
   */
  private enforceGate(scores: ToolCandidateScore[], tau: number): void {
    const baseline = scores.find((s) => s.isBaseline);
    if (!baseline) return; // 无基线参照 → 无法裁决退化
    const candidates = scores.filter((s) => !s.isBaseline);
    if (candidates.length === 0) return;
    const passing = this.select(candidates, baseline, tau);
    const passingIds = new Set(passing.map((p) => p.candidateId));
    for (const c of candidates) {
      if (!passingIds.has(c.candidateId)) {
        throw new ToolRetainGateError(
          `commitOnSuccess rejected: tool candidate '${c.candidateId}' failed strict-improvement gate ` +
            `(selection ∧ resolve 硬约束退化 ≥ τ=${tau}; PRD §6.7 / 02-loop-context §2.2) ` +
            `— fail-closed, no active/staging write`,
        );
      }
    }
  }

  /**
   * commit-on-success：候选**过门**才写 `tools/registry/<tool>.yaml` active（内容
   * 更新）+ staging 版本后缀（`staging/tool-<tool>.v{N}.yaml`，可回滚）+ 调
   * `ConfigRepo.pinSha` 重锁。
   *
   * **形状锁 fail-closed 守卫**（spec §L1-T07 错误路径）：候选改 schema 形状字段
   * （types/required/enum）→ `assertShapeLocked` throw + 落 `candidate_rejected_shape`
   * 事件，**不触盘**（不写 active / staging / pinSha）。形状锁比对基准 =
   * `baselineShape`（外部注入，shape-manifest.json 钉死版本）。
   *
   * 版本后缀是回滚的物理基础（PRD §6.4 keep-all variant）——绝不直接覆盖 active
   * 而不留版本后缀。
   *
   * `scores` 须含一个 `isBaseline===true` 基线 + ≥0 个候选分数。仅基线无候选时
   * 不裁决退化（向后兼容；生产 driver 须先 `select` 再 `commitOnSuccess` 串接）。
   */
  commitOnSuccess(
    candidate: ToolVariantCandidate,
    scores: ToolCandidateScore[],
    tau: number = DEFAULT_TOOL_TAU,
  ): void {
    // 形状锁预检（spec 错误路径：改 schema 形状 → reject + 事件，不触盘）
    if (this.baselineShape) {
      const manifest = extractInputSchemaShape(candidate.content);
      try {
        assertShapeLocked(candidate.toolName, manifest, this.baselineShape);
      } catch (err) {
        this.emit({
          event: SHAPE_REJECT_EVENT,
          kind: "shape",
          substrate: "tool",
          toolName: candidate.toolName,
          candidateId: candidate.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // strict-improvement 硬门裁决（selection ∧ resolve）
    this.enforceGate(scores, tau);

    if (!this.repo) {
      // 无 repo → 形状锁 + 门已过，但无法触盘；此处仅作 select/shape 守卫入口
      return;
    }

    const root = this.repo.getRoot();
    const activeRel = `${REGISTRY_DIR}/${candidate.toolName}.yaml`;
    const activeAbs = join(root, activeRel);

    // 写 staging 版本后缀（keep-all variant，回滚物理基础）
    const stagingDir = join(root, TOOL_STAGING_DIR);
    mkdirSync(stagingDir, { recursive: true });
    const next = nextToolVersion(stagingDir, candidate.toolName);
    const stagingAbs = join(stagingDir, `tool-${candidate.toolName}.v${next}.yaml`);
    writeFileSync(stagingAbs, candidate.content, "utf8");

    // 写 active（内容更新）
    mkdirSync(join(root, REGISTRY_DIR), { recursive: true });
    writeFileSync(activeAbs, candidate.content, "utf8");

    // 调 ConfigRepo.pinSha 重锁（versionSha 用新内容 sha，生产由 git HEAD 提供）
    const newSha = createHash("sha256").update(candidate.content).digest("hex");
    this.repo.pinSha(newSha);
  }
}

// ── 内部纯函数 ─────────────────────────────────────────────────────────────

/**
 * 扫描 staging 目录现有 `tool-<tool>.v{N}.yaml`，返回下一版本号。
 * 无既有版本 → 2（Voyager 起始约定）；有 → max(N)+1。
 */
function nextToolVersion(stagingDir: string, toolName: string): number {
  let max = 1;
  if (existsSync(stagingDir)) {
    for (const name of readdirSync(stagingDir) as string[]) {
      const re = new RegExp(`^tool-${toolName}\\.v(\\d+)\\.ya?ml$`);
      const m = re.exec(name);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

// 防止 readFileSync 未使用告警（保留供未来 baseline 加载扩展）
void readFileSync;
