// L1-T13 · HITL pause/approve policy 进化（重复副作用 hard constraint=0 ∧ false-pause↓；RunState static-core；breaker clause）
//
// HITL pause-resume policy 是 hook 的 ask 分支（02-loop-context §1.6(b)）。进化的
// 对象 = 何时触发中断的 policy（哪些 tool/action 需 pause、approve 粒度）。信号 =
// 重复副作用次数 = 0（**hard constraint**，非软目标——重复 commit / double-charge
// 不可恢复，不可用加权求和抵消，02-loop-context §1.6(d/e)）+ false-pause rate↓。
//
// RunState 序列化 schema / `unsent_tool_call_ids` 跟踪 / resume 重放语义 =
// static-core（L0C-T07a 契约），本模块只消费其形状，绝不放松跟踪。
//
// breaker clause（02-loop-context §1.6(f)）：放松 `unsent_tool_call_ids` 跟踪的
// diff 自动 reject（与 L1-T12a breaker 同源，复用方向语义）。

// ── 公共类型 ───────────────────────────────────────────────────────────────

/** 单条 HITL 规则：tool × action × 可选 predicate。 */
export interface HitlRule {
  /** tool 名（如 'bash' / 'write'）。 */
  readonly tool: string;
  /** 中断粒度：pause（粗）/ approve-coarse / approve-fine（细）。 */
  readonly action: "pause" | "approve-coarse" | "approve-fine";
  /** 可选谓词（'always' = 全量 pause；更具体 = 收窄范围）。 */
  readonly predicate?: string;
}

/** HITL policy 进化信号。 */
export interface HitlScore {
  /** 重复副作用次数 —— hard constraint = 0。 */
  readonly duplicateSideEffectCount: number;
  /** false-pause rate —— 越低越好（软目标，须在 dup==0 前提下）。 */
  readonly falsePauseRate: number;
  /** 是否 baseline（当前生效 policy 的信号）。 */
  readonly isBaseline: boolean;
}

/** breaker 拦截的 diff 形状（放松 unsent_tool_call_ids 跟踪）。 */
export interface HitlBreakerDiff {
  readonly field?: string;
  readonly from?: string;
  readonly to?: string;
}

// ── HardConstraintGate（REFACTOR：不可恢复副作用类基质复用） ───────────────

/**
 * Hard constraint gate：metric 必须等于 expectedValue，否则 throw。
 *
 * 抽出供未来不可恢复副作用类基质复用（重复 commit、double-charge、irreversible
 * mutation）。hard constraint 不可被软目标加权抵消（02-loop-context §1.6(d/e)）。
 */
export interface HardConstraintGate {
  readonly metric: keyof HitlScore;
  readonly expectedValue: number;
}

const DUPLICATE_SIDE_EFFECT_GATE: HardConstraintGate = {
  metric: "duplicateSideEffectCount",
  expectedValue: 0,
};

// ── 错误类型 ───────────────────────────────────────────────────────────────

/** 重复副作用 hard constraint 违反：duplicateSideEffectCount > 0。 */
export class DuplicateSideEffectViolation extends Error {
  readonly score: HitlScore;
  constructor(score: HitlScore, message?: string) {
    super(
      message ??
        `hard constraint violated: duplicateSideEffectCount=${score.duplicateSideEffectCount} (must be 0; irreversible side effects cannot be offset by soft goals)`,
    );
    this.name = "DuplicateSideEffectViolation";
    this.score = score;
  }
}

/** breaker clause 违反：放松 unsent_tool_call_ids 跟踪。 */
export class HitlBreakerError extends Error {
  readonly diff: HitlBreakerDiff;
  constructor(diff: HitlBreakerDiff, message?: string) {
    super(
      message ??
        `breaker reject: loosening 'unsent_tool_call_ids' tracking from '${diff.from}' to '${diff.to}' (RunState static-core)`,
    );
    this.name = "HitlBreakerError";
    this.diff = diff;
  }
}

// ── RunState unsent_tool_call_ids 跟踪状态（static-core 契约参考） ──────────

/** 表示「正在跟踪」的状态字面量（放松方向 = 从此处移出）。 */
const TRACKED_STATES = new Set(["tracked", "on", "strict", "enabled"]);
/** 表示「未跟踪」的状态字面量（放松终点）。 */
const UNTRACKED_STATES = new Set(["untracked", "off", "none", "disabled", "removed", "optional"]);

// ── HitlPolicy ─────────────────────────────────────────────────────────────

/**
 * HITL pause/approve policy 进化 driver。
 *
 * - `evolve(rules, scores)`：在 hard constraint（dup==0）短路通过的前提下，若
 *   false-pause rate 高，收窄 pause 范围（pause → approve-fine）。dup>0 的候选
 *   永不入选。
 * - `assertDuplicateSideEffectZero(score)`：count > 0 → throw
 *   `DuplicateSideEffectViolation`（hard constraint，select 前短路）。
 * - `assertBreaker(diff)`：放松 `unsent_tool_call_ids` 跟踪 → throw
 *   `HitlBreakerError`（breaker clause，02-loop-context §1.6(f)）。
 *
 * false-pause↓ 须在 duplicate==0 前提下生效——别让 model 学会「永远不 pause」
 * 提效（spec 执行提示 (2)）。本 driver 不允许把 pause 完全移除（只允许细化粒度），
 * 以守住该不变量。
 */
export class HitlPolicy {
  /** false-pause rate 高于该阈值时触发收窄（保守阈值）。 */
  private static readonly FALSE_PAUSE_HIGH_THRESHOLD = 0.3;

  /**
   * 进化 HITL policy。
   *
   * 1. hard constraint 短路：所有 dup>0 的候选被 reject（不参与选择）。
   * 2. 在 dup==0 的候选中，若 false-pause rate 高（> 阈值），收窄 pause 范围：
   *    action 'pause' → 'approve-fine'（细化粒度，而非移除 pause）。
   * 3. 无合格候选或 false-pause 不高时，返回原规则集（baseline 退化安全）。
   */
  evolve(
    rules: readonly HitlRule[],
    scores: HitlScore[],
  ): readonly HitlRule[] {
    // hard constraint 短路：dup>0 候选永不入选
    const eligible = scores.filter(
      (s) => s.duplicateSideEffectCount === DUPLICATE_SIDE_EFFECT_GATE.expectedValue,
    );
    // 无合格候选 → 退化返回原规则集（不进化）
    if (eligible.length === 0) {
      return Object.freeze(rules.map((r) => ({ ...r }))) as readonly HitlRule[];
    }
    // false-pause 高 → 收窄 pause 范围（仅在 dup==0 前提下）
    const maxFalsePause = Math.max(...eligible.map((s) => s.falsePauseRate));
    if (maxFalsePause > HitlPolicy.FALSE_PAUSE_HIGH_THRESHOLD) {
      return Object.freeze(
        rules.map((r) =>
          r.action === "pause"
            ? ({ ...r, action: "approve-fine" } as HitlRule)
            : ({ ...r } as HitlRule),
        ),
      ) as readonly HitlRule[];
    }
    // false-pause 不高 → 退化返回原规则集
    return Object.freeze(rules.map((r) => ({ ...r }))) as readonly HitlRule[];
  }

  /**
   * 重复副作用 hard constraint：count > 0 → throw。
   *
   * 重复 commit / double-charge 不可恢复，不可用加权求和抵消。须在 select 前
   * 短路调用（hard constraint 优先于一切软目标）。
   */
  assertDuplicateSideEffectZero(score: HitlScore): void {
    if (score.duplicateSideEffectCount > DUPLICATE_SIDE_EFFECT_GATE.expectedValue) {
      throw new DuplicateSideEffectViolation(score);
    }
  }

  /**
   * breaker clause：放松 `unsent_tool_call_ids` 跟踪 → throw。
   *
   * RunState 的 `unsent_tool_call_ids` 跟踪是 static-core（L0C-T07a），任何把
   * 跟踪从 tracked 放松到 untracked 的 diff 自动 reject（02-loop-context
   * §1.6(f)）。收紧方向（untracked → tracked）放行；非该字段 diff 放行。
   */
  assertBreaker(diff: HitlBreakerDiff | object): void {
    const d = diff as HitlBreakerDiff;
    if (d.field !== "unsent_tool_call_ids") return;
    const from = String(d.from ?? "").toLowerCase();
    const to = String(d.to ?? "").toLowerCase();
    if (from === to) return; // 无变化
    // 放松方向：tracked → untracked
    if (TRACKED_STATES.has(from) && UNTRACKED_STATES.has(to)) {
      const rejectDiff: { field?: string; from?: string; to?: string } = {};
      if (d.field !== undefined) rejectDiff.field = d.field;
      if (d.from !== undefined) rejectDiff.from = d.from;
      if (d.to !== undefined) rejectDiff.to = d.to;
      throw new HitlBreakerError(rejectDiff);
    }
    // 收紧方向（untracked → tracked）放行；未知状态保守放行（不在此 breaker 范围）
  }
}
