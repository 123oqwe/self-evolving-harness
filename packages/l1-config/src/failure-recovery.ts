// L1-T19 · failure recovery policy + 幂等 checklist 进化
// （checkpoint 在 super-step + node 幂等 static-core）
//
// 失败隔离与 checkpoint 幂等的恢复策略 + 幂等 self-check 清单
// （02-orchestration §6）。进化的对象 = `failure_recovery_policy.yaml`
// （`{failure_signature: {action, max_retries, reroute_target}}`）+
// `idempotency_checklist.md`。checkpoint 在 super-step 边界 / node 须幂等 =
// static-core。信号 = 恢复后 acceptance + 幂等事故率（resume 前后 side-effect
// 计数差 = 0）。
//
// 安全门：
// - `assertIdempotencyZero(score)`：count > 0 → throw `IdempotencyIncidentError`
//   （hard constraint：幂等事故 = contract 违反，double-commit / double-charge
//   不可恢复，不可用加权求和抵消，02-orchestration §6(e)）。
// - `assertCheckpointAtSuperStep(location)`：node-internal → throw
//   `CheckpointLocationError`（super-step 边界是 resume 正确性的信任锚点，
//   02-orchestration §6(a)）。
//
// 复用 vs 自研：
// - L3-T04 strict-improvement 复用方向（post-recovery acceptance↑ ∧
//   idempotency==0）。
// - L1-T13 `HardConstraintGate` 复用方向语义（不可恢复副作用类基质复用，
//   REFACTOR spec §L1-T19：幂等 hard constraint 复用 T13 守卫）。
// - 自研：进化 driver + 幂等 hard constraint + super-step 不变量守卫。

// ── 公共类型 ───────────────────────────────────────────────────────────────

/** 恢复动作（02-orchestration §6）。 */
export type RecoveryAction =
  | "retry"
  | "reroute"
  | "checkpoint_resume"
  | "abort";

/**
 * 单条 failure recovery 规则：failure_signature → {action, max_retries,
 * reroute_target?}。
 */
export interface RecoveryRule {
  /** 失败签名（如 'timeout' / 'rate_limit' / 'tool_not_found'）。 */
  readonly failureSignature: string;
  /** 恢复动作。 */
  readonly action: RecoveryAction;
  /** 最大重试次数（action=retry 时生效）。 */
  readonly maxRetries: number;
  /** reroute 目标（action=reroute 时必填）。 */
  readonly rerouteTarget?: string;
}

/**
 * failure recovery policy 进化信号。
 * - `postRecoveryAcceptance`：恢复后 acceptance（越高越好）。
 * - `idempotencyIncidentCount`：resume 前后 side-effect 计数差 ≠ 0 的次数 ——
 *   hard constraint = 0（幂等事故 = contract 违反）。
 * - `isBaseline`：是否 baseline（当前生效 policy 的信号）。
 */
export interface RecoveryScore {
  readonly postRecoveryAcceptance: number;
  readonly idempotencyIncidentCount: number;
  readonly isBaseline: boolean;
}

/** checkpoint 位置（02-orchestration §6(a)）。 */
export type CheckpointLocation = "super-step" | "node-internal";

// ── HardConstraintGate（REFACTOR：复用 T13 不可恢复副作用守卫方向） ────────

/**
 * Hard constraint gate：metric 必须等于 expectedValue，否则 throw。
 *
 * 复用 L1-T13 `HardConstraintGate` 方向语义（不可恢复副作用类基质）。
 * 幂等事故 = contract 违反，hard constraint 不可被软目标加权抵消
 * （02-orchestration §6(e)）。
 */
interface IdempotencyGate {
  readonly metric: keyof RecoveryScore;
  readonly expectedValue: number;
}

const IDEMPOTENCY_INCIDENT_GATE: IdempotencyGate = {
  metric: "idempotencyIncidentCount",
  expectedValue: 0,
};

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 幂等事故 hard constraint 违反：idempotencyIncidentCount > 0。
 *
 * resume 前后 side-effect 计数差 ≠ 0 = contract 违反（double-commit /
 * double-charge 不可恢复）。hard constraint = 0，非软目标，不可用加权求和抵消。
 */
export class IdempotencyIncidentError extends Error {
  readonly score: RecoveryScore;
  constructor(score: RecoveryScore, message?: string) {
    super(
      message ??
        `hard constraint violated: idempotencyIncidentCount=${score.idempotencyIncidentCount} (must be 0; resume side-effect delta is a contract violation, cannot be offset by soft goals)`,
    );
    this.name = "IdempotencyIncidentError";
    this.score = score;
  }
}

/**
 * checkpoint 位置违反：checkpoint 在 node 内部而非 super-step 边界。
 *
 * super-step 边界是 resume 正确性的信任锚点（02-orchestration §6(a)）；
 * node-internal checkpoint 破坏 resume 幂等性，static-core 不可放松。
 */
export class CheckpointLocationError extends Error {
  readonly checkpointLocation: CheckpointLocation;
  constructor(checkpointLocation: CheckpointLocation, message?: string) {
    super(
      message ??
        `checkpoint at '${checkpointLocation}' (must be at super-step boundary; node-internal checkpoint breaks resume idempotency, 02-orchestration §6(a))`,
    );
    this.name = "CheckpointLocationError";
    this.checkpointLocation = checkpointLocation;
  }
}

// ── 纯函数：strict-improvement 门（复用 L3-T04 方向） ─────────────────────

/** strict-improvement 退化容忍阈值 τ（与 T04b/T05b 一致）。 */
const STRICT_IMPROVEMENT_TAU = 0;

/**
 * strict-improvement 硬门（复用 L3-T04 方向）：候选 postRecoveryAcceptance↑
 * ∧ idempotencyIncidentCount==0（事故率↓ 至 0；任一退化 ≥ τ → false）。
 *
 * 无加权求和——acceptance 须改善且幂等事故须为 0（与 T04b Pareto 同源：
 * 不可 scalar 化抵消幂等事故）。
 */
export function recoveryStrictImprovementGate(
  candidate: RecoveryScore,
  baseline: RecoveryScore,
  tau: number = STRICT_IMPROVEMENT_TAU,
): boolean {
  const acceptanceUp =
    candidate.postRecoveryAcceptance >= baseline.postRecoveryAcceptance - tau;
  const idempotencyZero =
    candidate.idempotencyIncidentCount ===
    IDEMPOTENCY_INCIDENT_GATE.expectedValue;
  // 至少一项严格改善（避免无变化入选）；幂等事故须为 0（hard constraint）。
  const strictlyBetter =
    candidate.postRecoveryAcceptance > baseline.postRecoveryAcceptance ||
    (candidate.idempotencyIncidentCount < baseline.idempotencyIncidentCount &&
      candidate.idempotencyIncidentCount === 0);
  return acceptanceUp && idempotencyZero && strictlyBetter;
}

// ── FailureRecovery ────────────────────────────────────────────────────────

/** baseline post-recovery acceptance 低于此值视为「action 误分类」信号。 */
const MISCLASSIFIED_ACCEPTANCE_THRESHOLD = 0.5;

/**
 * failure recovery policy 进化 driver + 幂等 hard constraint + super-step
 * 不变量守卫。
 *
 * - `evolve(rules, checklist, scores)`：在 hard constraint（idempotency==0）
 *   短路通过的前提下，候选 strict-improvement（acceptance↑ ∧ 事故==0）入选，
 *   调整 action / max_retries / reroute_target，并可能加 checklist 项
 *   （如「用 upsert」）且事故率↓。idempotency>0 候选永不入选。
 * - `assertIdempotencyZero(score)`：count > 0 → throw
 *   `IdempotencyIncidentError`（hard constraint，select 前短路）。
 * - `assertCheckpointAtSuperStep(location)`：node-internal → throw
 *   `CheckpointLocationError`（super-step 边界 static-core）。
 *
 * 幂等事故是 contract 违反——resume 后 double-commit / double-charge 不可恢复，
 * hard constraint = 0 非软目标（spec 执行提示 (1)）。
 */
export class FailureRecovery {
  /**
   * 进化 failure recovery policy + 幂等 checklist。
   *
   * 1. hard constraint 短路：所有 idempotencyIncidentCount>0 的候选被 reject
   *    （不参与选择；幂等事故 = contract 违反）。
   * 2. 拆 baseline / candidate。在 idempotency==0 的候选中，找首个
   *    strict-improvement（acceptance↑ ∧ 事故==0）候选：
   *    - 调整 action（如 retry → retry 且 max_retries↑；reroute → retry 当
   *      baseline 显示 reroute 误分类）。
   *    - 边界：加 checklist 项（「用 upsert」）且事故率↓ → 允许。
   * 3. 无合格候选时：若 baseline acceptance 低且 action=reroute（误分类信号：
   *    「该 retry 却 reroute」），调整 action=reroute → retry。
   * 4. 全无改善 → 退化返回原 rules + 原 checklist（fail-safe）。
   */
  evolve(
    rules: readonly RecoveryRule[],
    checklist: string,
    scores: RecoveryScore[],
  ): { rules: readonly RecoveryRule[]; checklist: string } {
    const baseline = scores.find((s) => s.isBaseline) ?? scores[0];
    const candidates = scores.filter((s) => !s.isBaseline);

    // 复制 baseline，准备进化覆盖。
    let evolvedRules: readonly RecoveryRule[] = Object.freeze(
      rules.map((r) => ({ ...r })) as RecoveryRule[],
    );
    let evolvedChecklist: string = checklist;

    // hard constraint 短路：idempotency>0 候选永不入选。
    const eligible = candidates.filter(
      (s) => s.idempotencyIncidentCount === IDEMPOTENCY_INCIDENT_GATE.expectedValue,
    );

    // 候选 strict-improvement 路径（acceptance↑ ∧ 事故==0）。
    if (baseline && eligible.length > 0) {
      const improving = eligible.find((c) =>
        recoveryStrictImprovementGate(c, baseline),
      );
      if (improving) {
        // 入选：调整 action / max_retries。
        evolvedRules = Object.freeze(
          rules.map((r) => {
            if (r.action === "retry") {
              // 重试类：放宽 max_retries（受 strict-improvement 信号驱动）。
              return { ...r, maxRetries: r.maxRetries + 1 } satisfies RecoveryRule;
            }
            return { ...r } as RecoveryRule;
          }),
        ) as readonly RecoveryRule[];
        // 边界：加 checklist 项（「用 upsert」）且事故率↓ → 允许。
        evolvedChecklist = checklist + "\n- use upsert / idempotency-key for all side-effecting writes";
        return { rules: evolvedRules, checklist: evolvedChecklist };
      }
    }

    // 误分类路径：baseline acceptance 低 + action=reroute（「该 retry 却 reroute」）
    // → 调整 action 为 retry（恢复策略 misclassification 修正）。
    if (
      baseline &&
      baseline.postRecoveryAcceptance < MISCLASSIFIED_ACCEPTANCE_THRESHOLD
    ) {
      evolvedRules = Object.freeze(
        rules.map((r) => {
          if (r.action === "reroute") {
            const adjusted: RecoveryRule = {
              failureSignature: r.failureSignature,
              action: "retry",
              maxRetries: Math.max(r.maxRetries, 1),
            };
            return adjusted;
          }
          return { ...r } as RecoveryRule;
        }),
      ) as readonly RecoveryRule[];
      return { rules: evolvedRules, checklist: evolvedChecklist };
    }

    // 全无改善 → 退化返回原 rules + 原 checklist（fail-safe）。
    return { rules: evolvedRules, checklist: evolvedChecklist };
  }

  /**
   * 幂等事故 hard constraint：count > 0 → throw。
   *
   * resume 前后 side-effect 计数差 ≠ 0 = contract 违反（double-commit /
   * double-charge 不可恢复）。须在 select 前短路调用（hard constraint 优先于
   * 一切软目标）。
   */
  assertIdempotencyZero(score: RecoveryScore): void {
    if (
      score.idempotencyIncidentCount > IDEMPOTENCY_INCIDENT_GATE.expectedValue
    ) {
      throw new IdempotencyIncidentError(score);
    }
  }

  /**
   * 守卫：checkpoint 须在 super-step 边界（resume 正确性信任锚点）。
   *
   * `checkpointLocation === 'node-internal'` → throw `CheckpointLocationError`
   * （super-step 边界 = static-core，node-internal checkpoint 破坏 resume 幂等）。
   * `'super-step'` → 放行。
   */
  assertCheckpointAtSuperStep(
    checkpointLocation: CheckpointLocation,
  ): void {
    if (checkpointLocation === "node-internal") {
      throw new CheckpointLocationError(checkpointLocation);
    }
  }
}
