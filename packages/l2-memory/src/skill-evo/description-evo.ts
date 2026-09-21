// L2-T09a — skill description GEPA 进化 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T09a
//
// description 是 skill 的唯一 retrieval key（Level-1 注入 system prompt，
// 决定 skill 是否被触发）。本模块采集 held-out 触发准确率混淆矩阵作为
// description 进化的 fitness，并提供 staging→active 晋升门（触发准确率不降
// 才上线，canary）。
//
// 本任务**不**实现 GEPA 优化器本身（L3 负责），只实现 fitness 采集点 +
// 晋升门。触发准确率用确定性 oracle（shouldTrigger vs didTrigger），
// **禁** LLM 自评判。
//
// ERRATA-w2plus 裁决：
//   L2-03: TaskRef = { id, shouldTrigger, didTrigger }（构造混淆矩阵）。
//   L2-04: Skill = SkillVariant（别名统一为 T09b 的 SkillVariant 形状）。
//   L2-06: 无 ctx 签名的函数加可选 ctx（measureTriggerAccuracy 不加；
//          promoteDescription 加可选 ctx 第四参，与测试调用一致）。

import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";
import type { RejectReason } from "../semantic/fact-store.js";

// ---------------------------------------------------------------------------
// 共享类型（T09b 复用：Skill = SkillVariant，ERRATA L2-04）
// ---------------------------------------------------------------------------

export type SkillStatus = "staging" | "active" | "archived";

/**
 * SkillVariant —— 版本化的 skill 变体。
 *
 * `description` 为 retrieval key（本任务进化目标）；`body` 为 Level-2 指令
 * 文本；`scripts` 为 Level-3 可执行代码（T09b）。`status` 标识生命周期
 * 阶段（staging / active / archived）。
 */
export interface SkillVariant {
  id: string;
  name: string;
  version: number;
  /** retrieval key（Level-1 注入 system prompt）。本任务进化目标。 */
  description?: string;
  /** Level-2 指令文本（T09b 进化目标）。 */
  body: string;
  /** Level-3 可执行代码（T09b）。 */
  scripts?: string;
  status: SkillStatus;
  provenance: Provenance;
}

/** ERRATA L2-04: Skill = SkillVariant（别名统一）。 */
export type Skill = SkillVariant;

// ---------------------------------------------------------------------------
// T09a 专属类型
// ---------------------------------------------------------------------------

/**
 * 触发准确率混淆矩阵。确定性 oracle（shouldTrigger）vs agent 行为
 * （didTrigger）计数。
 */
export interface TriggerConfusion {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}

/**
 * ERRATA L2-03: held-out task 引用 —— `{ id, shouldTrigger, didTrigger }`。
 *
 * - `shouldTrigger`: oracle 裁决该 skill 在此 task 上是否应被触发。
 * - `didTrigger`: agent 实际行为是否触发了该 skill。
 */
export interface TaskRef {
  id: string;
  shouldTrigger: boolean;
  didTrigger: boolean;
}

// ---------------------------------------------------------------------------
// fitness 采集点
// ---------------------------------------------------------------------------

/**
 * 采集 held-out 触发准确率混淆矩阵（description 进化的 fitness）。
 *
 * - TP: shouldTrigger=T & didTrigger=T
 * - FN: shouldTrigger=T & didTrigger=F（漏触发）
 * - FP: shouldTrigger=F & didTrigger=T（误触发）
 * - TN: shouldTrigger=F & didTrigger=F
 *
 * 边界：0 个 held-out task → 返回全 0 矩阵 + warn（数据不足，无统计意义）。
 *
 * @param _skillId skill 标识（保留供 L3 evolve-skill 适配层路由；本任务不使用）
 * @param heldOutTasks held-out task 列表
 */
export function measureTriggerAccuracy(
  _skillId: string,
  heldOutTasks: TaskRef[],
): TriggerConfusion {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;

  for (const t of heldOutTasks) {
    if (t.shouldTrigger && t.didTrigger) {
      truePositive++;
    } else if (t.shouldTrigger && !t.didTrigger) {
      falseNegative++;
    } else if (!t.shouldTrigger && t.didTrigger) {
      falsePositive++;
    } else {
      trueNegative++;
    }
  }

  if (heldOutTasks.length === 0) {
    // 边界：无 held-out 数据，fitness 无统计意义，warn（不抛出）。
    // 走 side channel（console）而非 MemCtx.warnings —— 本函数无 ctx 形参。
    console.warn(
      `[l2-t09a] measureTriggerAccuracy: 0 held-out tasks for skill "${_skillId}" — ` +
        `confusion matrix is all zeros (insufficient data)`,
    );
  }

  return { truePositive, falsePositive, falseNegative, trueNegative };
}

// ---------------------------------------------------------------------------
// staging → active 晋升门
// ---------------------------------------------------------------------------

/**
 * 将 staging description 晋升为 active。
 *
 * canary 安全门：staging description 在 held-out 上触发准确率 delta > 0
 * （严格提升）才晋升 active；delta <= 0 reject "trigger accuracy regression"
 * （触发准确率回退）。
 *
 * @param skillId 目标 skill
 * @param stagingDesc staging 候选 description 文本
 * @param heldOutDelta staging vs active 在 held-out 上的触发准确率 delta
 * @param ctx 可选 MemCtx（provenance 追溯 + side channel warnings）
 * @returns 晋升成功 → Skill（status='active'）；回退 → RejectReason（ok:false）
 */
export function promoteDescription(
  skillId: string,
  stagingDesc: string,
  heldOutDelta: number,
  ctx?: MemCtx,
): Skill | RejectReason {
  // 晋升门：delta > 0（严格提升，canary 不降才上线 → 这里取更严的 delta>0，
  // 与 spec GREEN 实现要点 "晋升门检查 delta>0" 一致）。
  if (heldOutDelta <= 0) {
    const msg =
      heldOutDelta < 0
        ? `trigger accuracy regression: heldOutDelta=${heldOutDelta} < 0`
        : `trigger accuracy regression: heldOutDelta=${heldOutDelta} (no improvement, delta must be > 0)`;
    // side channel warn（ERRATA L2-05 模式：经 ctx.warnings）
    ctx?.warnings?.push(`[l2-t09a] promoteDescription rejected: ${msg}`);
    return {
      ok: false,
      reason: "type_user_higher_gate",
      msg,
    };
  }

  const now = Date.now();
  const provenance: Provenance = {
    sessionId: ctx?.sessionId ?? "unknown",
    taskId: ctx?.taskId ?? "L2-T09a",
    promptHash: ctx?.promptHash ?? "unknown",
    agentId: ctx?.agentId ?? "unknown",
    ts: now,
  };

  const promoted: Skill = {
    id: skillId,
    name: skillId,
    version: 1,
    description: stagingDesc,
    body: stagingDesc,
    status: "active",
    provenance,
  };

  return promoted;
}
