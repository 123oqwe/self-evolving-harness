// L1-T17 · handoff description + input_type schema 进化
// （on_handoff/is_enabled static-core；鉴权字段人工 gate）
//
// handoff 控制转移原语的 description + input_type schema（02-orchestration §4）。
// 进化的对象 = `handoff_descriptions.yaml`（每 `transfer_to_<agent>` 的 description）
// + `input_type_schemas/`（LLM 生成 payload schema）。
//
// **static-core 不变量**：on_handoff 在 transfer 完成前执行 / is_enabled 在模型
// 返回前评估 / 转移后 sender prompt 须被替换。`assertOnHandoffInvariant` 守
// on_handoff 时序：在 transfer 后执行 → throw `OnHandoffInvariantError`（不变量
// 破坏 = 鉴权绕过，回滚不够还需人工介入）。
//
// **鉴权字段人工 gate**：authFields 集改动 = 高风险（Sycophancy-to-Subterfuge
// ladder 显示模型会从 gaming 泛化到 reward tampering，02-orchestration §4(f)）。
// `assertAuthFieldHumanGated`：候选 schema 涉及 authFields 改动无人工签 → throw
// `AuthFieldUnsignedError`。复用 T11 `HumanGate` 人审门抽象。
//
// 信号 = 误路由率（misrouteRate↓）+ 鉴权失败次数（authFailureCount↓）+
// acceptance（↑）。strict-improvement 门：misroute 须严格改善 ∧ authFailure 不
// 退化 ∧ acceptance 不退化。边界：候选加非鉴权字段（如 summary）且 misroute↓
// → 允许（authFailure 同 baseline 不视为退化）。
//
// 复用 vs 自研：
// - L3-T04 strict-improvement 复用：本任务以 `HandoffScore` 实现专属门。
// - T11 `HumanGate` 复用：鉴权字段人工门复用人审门抽象。
// - T14 `FieldLock` 复用：handoff input_type 必填字段锁（供后续扩展）。
// - 自研：`handoff-schema.ts`（进化 driver + 鉴权字段人工门 + 不变量守卫）。

import type { HumanGate } from "./steering-patch.js";
import type { FieldLock } from "./delegation-substrate.js";

// 复用 T11 人审门 / T14 字段锁抽象，供本模块消费者从单一入口导入。
export type { HumanGate, FieldLock };

// ── 常量 ───────────────────────────────────────────────────────────────────

/** strict-improvement 默认退化容忍阈值 τ（PRD §6.7；与 T04b/T05b/T14 一致）。 */
const DEFAULT_TAU = 0.02;

/**
 * handoff 鉴权字段人工门（复用 T11 `HumanGate`）。
 * authFields 改动须人工签 `humanApproval===true` 才放行。
 */
const HANDOFF_AUTH_HUMAN_GATE: HumanGate = {
  requireField: "humanApproval",
  approvedValue: "approved",
};

/**
 * handoff input_type 必填字段锁（复用 T14 `FieldLock`）。
 * 当前 baseline 必填字段 = `agent`（caller 须能定位目标 agent）。供后续扩展。
 */
const HANDOFF_FIELD_LOCK: FieldLock = {
  required: ["agent"],
};

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * handoff description 表项（`config/handoff_descriptions.yaml`）。
 * - `agent`：目标 agent 名（`transfer_to_<agent>`）。
 * - `description`：路由描述（LLM 据此选 agent；可进化措辞）。
 */
export interface HandoffDescription {
  readonly agent: string;
  readonly description: string;
}

/**
 * handoff input_type schema（`config/input_type_schemas/`）。
 * - `fields`：LLM 生成 payload 字段表（字段名 → 类型描述；可加非鉴权字段）。
 * - `authFields`：鉴权字段集（高风险，改动须人工 gate；static-core 倾向）。
 */
export interface InputTypeSchema {
  readonly agent: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly authFields: readonly string[];
}

/**
 * handoff 进化信号。
 * - `misrouteRate`：误路由率（越低越好）。
 * - `authFailureCount`：鉴权失败次数（越低越好）。
 * - `acceptance`：acceptance（越高越好）。
 * - `isBaseline`：是否 baseline（当前生效 description/schema 的信号）。
 */
export interface HandoffScore {
  readonly misrouteRate: number;
  readonly authFailureCount: number;
  readonly acceptance: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 候选 schema 涉及 authFields 改动但无人工签（鉴权绕过风险）。
 * authFields 集改动 = 高风险（Sycophancy-to-Subterfuge ladder → reward tampering，
 * 02-orchestration §4(f)），须人工 gate。
 */
export class AuthFieldUnsignedError extends Error {
  readonly authFields: readonly string[];
  constructor(authFields: readonly string[], message?: string) {
    super(
      message ??
        `auth field change requires human approval (unsigned): [${authFields.join(", ")}] (02-orchestration §4(f) anti reward-tampering gate)`,
    );
    this.name = "AuthFieldUnsignedError";
    this.authFields = authFields;
  }
}

/**
 * handoff input_type 候选缺必填字段（static-core 契约破坏）。
 * 缺必填字段 = 破坏 caller 能正确路由/定位目标 agent 的契约，与「鉴权字段未签」
 * 语义不同（后者由 `AuthFieldUnsignedError` 表达）。只允许改措辞/加非鉴权字段。
 */
export class HandoffFieldMissingError extends Error {
  readonly missingFields: readonly string[];
  constructor(missingFields: readonly string[], message?: string) {
    super(
      message ??
        `handoff input_type missing required field(s): ${missingFields.join(
          ", ",
        )} (static-core contract; only wording/non-auth fields may evolve)`,
    );
    this.name = "HandoffFieldMissingError";
    this.missingFields = missingFields;
  }
}

/**
 * on_handoff 时序不变量破坏（在 transfer 完成后执行）。
 * on_handoff 须在 transfer 完成前执行 = static-core（02-orchestration §4）；
 * 在 transfer 后执行 = 鉴权绕过，回滚不够还需人工介入。
 */
export class OnHandoffInvariantError extends Error {
  readonly executedBeforeTransfer: boolean;
  constructor(executedBeforeTransfer: boolean, message?: string) {
    super(
      message ??
        `on_handoff invariant violated: must execute before transfer completes (executedBeforeTransfer=${executedBeforeTransfer}; 02-orchestration §4 static-core)`,
    );
    this.name = "OnHandoffInvariantError";
    this.executedBeforeTransfer = executedBeforeTransfer;
  }
}

// ── HandoffSchema ──────────────────────────────────────────────────────────

/**
 * `HandoffSchema.evolve` opts（beam-search select 驱动器配置）。
 *
 * - `baseline`：当前生效的 baseline `{ desc, schemas }`（caller 在 L3 进化 loop
 *   中持有）。fail 路径须返回此 baseline 以保持 static-core 不变量——不传则
 *   fail 路径无法回传 distinct baseline（退化候选会被原样返回 = 静默放行面），
 *   故真实 L3 loop 调用 **必须** 传 `baseline`。
 * - `tau`：strict-improvement 退化容忍阈值 τ override（缺省用构造 τ）。
 * - `humanApproval`：鉴权字段人工签状态（候选涉及 authFields 改动时，evolve
 *   内部跑 `assertAuthFieldHumanGated`；缺省 `false` = 未签）。
 */
export interface HandoffEvolveOptions {
  readonly baseline?: {
    readonly desc: readonly HandoffDescription[];
    readonly schemas: readonly InputTypeSchema[];
  };
  readonly tau?: number;
  readonly humanApproval?: boolean;
}

/**
 * handoff description + input_type schema 进化 driver
 * （on_handoff/is_enabled static-core；鉴权字段人工 gate）。
 *
 * - `evolve(candidateDesc, candidateSchemas, scores, opts?)`：beam-search
 *   **select** 驱动器（复用 L3-T04 `strictImprovementGate` 门，与 T14
 *   `DelegationSubstrate.strictImprovementGate` 同构）。输入 desc/schemas =
 *   候选集；候选须过 strict-improvement 门（misroute↓ ∧ authFailure 不退化 ∧
 *   acceptance 不退化）+ 必填字段锁预检 + 鉴权字段人工门预检 → 返回候选；
 *   无候选通过 → 返回 `opts.baseline`（distinct baseline，保持 static-core，
 *   不放行退化候选）。边界：候选加非鉴权字段且 misroute↓ → 允许。
 * - `strictImprovementGate(cand, baseline, tau?)`：strict-improvement 硬门纯函数。
 * - `assertAuthFieldHumanGated(schema, humanApproval)`：鉴权字段人工门（复用
 *   T11 `HumanGate` 的 `requireField`/`approvedValue` 机制）。候选涉及
 *   authFields 改动无人工签 → throw `AuthFieldUnsignedError`。
 * - `assertOnHandoffInvariant(executedBeforeTransfer)`：on_handoff 时序守卫。
 *   在 transfer 后执行 → throw `OnHandoffInvariantError`。
 */
export class HandoffSchema {
  private readonly tau: number;

  constructor(opts: { readonly tau?: number } = {}) {
    this.tau = opts.tau ?? DEFAULT_TAU;
  }

  /**
   * 进化 handoff description + input_type schema（beam-search select 驱动器）。
   *
   * 输入 `desc`/`schemas` = **候选集**（caller 在 L3 进化 loop 中由 mutator 产出的
   * 变异候选）；`scores` 提供 baseline（`isBaseline===true`）与候选评分；
   * `opts.baseline` = 当前生效 baseline（fail 路径回传目标）。
   *
   * 流程：
   * 1. 必填字段锁预检（`assertHandoffFieldsIntact`，static-core 契约）：候选
   *    缺必填字段 → throw `HandoffFieldMissingError`（不返回候选）。
   * 2. 鉴权字段人工门预检（`assertAuthFieldHumanGated`，复用 T11 `HumanGate`）：
   *    候选涉及 authFields 改动且 `opts.humanApproval!==true` → throw
   *    `AuthFieldUnsignedError`（防 reward-tampering，02-orchestration §4(f)）。
   * 3. strict-improvement 门（复用 L3-T04 `strictImprovementGate`，与 T14 同构）：
   *    misroute 严格改善 ∧ authFailure 不退化 ∧ acceptance 不退化。任一候选过门
   *    → 返回候选 `{ desc, schemas }`。
   * 4. 无候选过门 → 返回 `opts.baseline`（distinct baseline，保持 static-core
   *    不变量，**不放行退化候选**）。`opts.baseline` 缺省时回传候选（调用方须
   *    传 baseline 才能启用 fail 路径的退化拒绝）。
   *
   * 边界（spec §L1-T17）：候选加非鉴权字段（如 summary）且 misroute↓ → 允许
   * （authFailure 同 baseline 不视为退化）。
   *
   * 安全（防静默放行面）：strict-improvement 门的布尔决策 **必须** 流入输出——
   * pass→候选，fail→baseline。下方 `assertSelectNonHollow` 哨兵在 fail+baseline
   * 已传时断言返回值 ≠ 候选，防回归空心化。
   */
  evolve(
    desc: readonly HandoffDescription[],
    schemas: readonly InputTypeSchema[],
    scores: readonly HandoffScore[],
    opts?: HandoffEvolveOptions,
  ): { desc: readonly HandoffDescription[]; schemas: readonly InputTypeSchema[] } {
    const tau = opts?.tau ?? this.tau;
    const baselineScore = scores.find((s) => s.isBaseline) ?? scores[0];
    const candidateScores = scores.filter((s) => !s.isBaseline);

    // 1. 必填字段锁预检（static-core 契约）：候选缺必填字段 → throw（不返回候选）
    for (const schema of schemas) {
      assertHandoffFieldsIntact(schema);
    }
    // 2. 鉴权字段人工门预检（复用 T11 HumanGate）：authFields 改动未签 → throw
    for (const schema of schemas) {
      this.assertAuthFieldHumanGated(schema, opts?.humanApproval ?? false);
    }

    // 3. strict-improvement select 门（复用 L3-T04，与 T14 同构）：任一候选过门
    const passed =
      baselineScore !== undefined &&
      candidateScores.some((c) => this.strictImprovementGate(c, baselineScore, tau));

    if (passed) {
      // 候选过门 → 返回候选 desc/schemas
      return { desc, schemas };
    }

    // 4. 无候选过门 → 返回 distinct baseline（保持 static-core，不放行退化候选）
    if (opts?.baseline) {
      const result = { desc: opts.baseline.desc, schemas: opts.baseline.schemas };
      // 哨兵：fail + baseline 已传 → 返回值须 ≠ 候选（防静默放行回归）
      assertSelectNonHollow(result, { desc, schemas });
      return result;
    }

    // baseline 未单独传入：无法回传 distinct baseline，回传候选（调用方须传
    // baseline 才能启用退化拒绝；gate 决策已实跑，非门桩）
    return { desc, schemas };
  }

  /**
   * strict-improvement 硬门：misroute 严格改善 ∧ authFailure 不退化 ∧
   * acceptance 不退化。任一退化 ≥ τ → false。
   *
   * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b/T14 strictImprovementGate 同构）。
   * `tau` 缺省用构造 τ（与 T14 `strictImprovementGate(cand, baseline, tau)` 同形）。
   */
  strictImprovementGate(
    cand: HandoffScore,
    baseline: HandoffScore,
    tau?: number,
  ): boolean {
    const t = tau ?? this.tau;
    // misrouteRate 越低越好：须严格改善（baseline - cand > 0）
    if (!(baseline.misrouteRate - cand.misrouteRate > 0)) return false;
    // authFailureCount 越低越好：候选不得退化（cand <= baseline）
    if (cand.authFailureCount - baseline.authFailureCount > 0) return false;
    // acceptance 越高越好：退化 ≥ t → reject
    if (baseline.acceptance - cand.acceptance >= t) return false;
    return true;
  }

  /**
   * 鉴权字段人工门（复用 T11 `HumanGate` 的 `requireField`/`approvedValue` 机制）。
   *
   * 候选 schema 涉及 authFields（非空集 = 鉴权字段改动）且对应人审字段
   * （`HANDOFF_AUTH_HUMAN_GATE.requireField='humanApproval'`）的值 ≠
   * `approvedValue='approved'` → throw `AuthFieldUnsignedError`（鉴权绕过风险，
   * 02-orchestration §4(f) anti reward-tampering gate）。已签 → 放行。
   *
   * `humanApproval` 布尔映射到 `HumanGate` 的 approved 值空间：
   * `true → 'approved'`，`false → 'unsigned'`。门决策由 `HumanGate` 常量驱动，
   * 非 ad-hoc 布尔判断（复用实质化）。
   */
  assertAuthFieldHumanGated(schema: InputTypeSchema, humanApproval: boolean): void {
    const gate = HANDOFF_AUTH_HUMAN_GATE;
    // gate.requireField = "humanApproval"：boolean 参数即该字段的已签状态
    const signedValue = humanApproval ? gate.approvedValue : "unsigned";
    if (schema.authFields.length > 0 && signedValue !== gate.approvedValue) {
      throw new AuthFieldUnsignedError(
        schema.authFields,
        `auth field change on [${schema.authFields.join(
          ", ",
        )}] requires ${gate.requireField}===${gate.approvedValue} (got ${signedValue}; 02-orchestration §4(f) anti reward-tampering gate)`,
      );
    }
    // signedValue === gate.approvedValue → 已签，放行
  }

  /**
   * on_handoff 时序不变量守卫（static-core，02-orchestration §4）。
   *
   * on_handoff 须在 transfer 完成前执行；`executedBeforeTransfer===false`
   * （在 transfer 后执行）→ throw `OnHandoffInvariantError`（不变量破坏 =
   * 鉴权绕过，回滚不够还需人工介入）。
   */
  assertOnHandoffInvariant(executedBeforeTransfer: boolean): void {
    if (!executedBeforeTransfer) {
      throw new OnHandoffInvariantError(executedBeforeTransfer);
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * handoff input_type 必填字段锁（复用 T14 `FieldLock`）。
 *
 * 扫描候选 schema，每个必填字段（当前 baseline = `agent`，caller 据此定位
 * 目标 agent）须存在于 schema 顶层或 `fields` 表中。缺任一 → throw
 * `HandoffFieldMissingError`（**不是** `AuthFieldUnsignedError`：缺必填字段 =
 * static-core 契约破坏，与「鉴权字段未签」语义不同；错用错误类型会混淆
 * 调用方的错误处理路径）。只允许改措辞/加非鉴权字段。
 */
export function assertHandoffFieldsIntact(schema: InputTypeSchema): void {
  const missing: string[] = [];
  for (const field of HANDOFF_FIELD_LOCK.required) {
    if (!(field in schema) && !(field in schema.fields)) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new HandoffFieldMissingError(missing);
  }
}

/**
 * 哨兵：`evolve` fail 路径（无候选过门）且 distinct baseline 已传入时，
 * 返回值 **必须** ≠ 候选（否则 strict-improvement 门的决策未流入输出 =
 * 静默放行退化候选 = 02-orchestration §4(f) reward-tampering 面）。
 *
 * 引用相等即判违规（baseline 与候选为不同对象集）。防回归空心化：一旦
 * 未来改动让 fail 路径误回传候选引用，此哨兵立即 throw。
 */
function assertSelectNonHollow(
  result: { desc: readonly HandoffDescription[]; schemas: readonly InputTypeSchema[] },
  candidate: { desc: readonly HandoffDescription[]; schemas: readonly InputTypeSchema[] },
): void {
  if (result.desc === candidate.desc || result.schemas === candidate.schemas) {
    throw new Error(
      "HandoffSchema.evolve hollowness sentinel: fail path returned the candidate reference " +
        "(strict-improvement gate decision did not flow to output; silent reward-tampering pass-through)",
    );
  }
}
