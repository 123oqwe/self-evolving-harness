// L2-T12: Ratchet τ/N_min/C GEPA Pareto 调参 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T12（含 ERRATA-w2plus MemCtx 裁决）。
//
// 本任务只实现三参数 schema + guard + drift 指标采集点；
// GEPA Genetic-Pareto 优化器由 L3 负责（本模块仅提供指标供 Pareto 选择）。
//
// 设计约束（spec 执行提示）：
//  - C>0 是非发散保证下限（C=0 退化为无界增长），必 reject。
//  - Ratchet 非发散证明依赖 contribution outcome-driven（deterministic），
//    禁换 LLM judge——故 validateParams 不引入非确定性。
//  - authoring prior 不可退役（meta-skill authoring prior guard），
//    委托 L2-T10 lifecycle 的 isAuthoringPrior 语义（本任务通过 ctx side channel
//    `retireAuthoringPriorAttempt` 检测退役尝试，避免反向依赖 T10 内部实现）。
//
// 注意：RatchetParams 类型已由 auto-memory/memory-bank.ts（L2-T03b）定义并经
// barrel 导出。为遵守"同包前序文件不删改、barrel 只追加"，本文件复用该类型
// （re-export type-only），不重复声明 interface，避免 barrel 重名冲突。

import type { MemCtx } from "../memory-tool/commands.js";
import type { RatchetParams } from "../auto-memory/memory-bank.js";

// 重导出类型供本模块消费者就近引用（不与 barrel 冲突：type-only re-export
// 不会在 `export *` 层面产生值重复；barrel 仅追加本文件的具名函数导出）。
export type { RatchetParams } from "../auto-memory/memory-bank.js";

/**
 * Ratchet 参数校验拒绝原因（判别联合）。
 *
 * 注意：spec 接口签名为 `validateParams(...): RejectReason[]`，其中 RejectReason
 * 已由 semantic/fact-store.ts 定义为判别联合。为避免 barrel 重名冲突且遵守
 * "前序文件不删改"，本模块定义独立的拒绝原因类型，validateParams 返回其数组。
 * 测试仅检查 `errs.length` 与 `JSON.stringify(errs)` 中的 msg 子串，故不依赖
 * fact-store 的 RejectReason 形状。
 */
export type RatchetRejectReason = {
  ok: false;
  reason: "c_must_be_positive" | "authoring_prior_not_retirable";
  msg: string;
};

/**
 * 校验 Ratchet 三参数 + authoring prior 退役 guard。
 *
 * @param params  RatchetParams（τ / N_min / C）。
 * @param ctx     可选 MemCtx；通过 side channel
 *                `retireAuthoringPriorAttempt:true` 携带"尝试退役 authoring prior"
 *                信号（L2-T10 lifecycle 注入）。
 * @returns 拒绝原因数组；空数组表示 accept。
 *
 * 行为规范（spec §L2-T12）：
 *  - C=0  → reject "C must be > 0"。
 *  - C<0  → reject（边界）。
 *  - C=50 → accept（errs.length===0）。
 *  - authoring prior 被标记退役 → reject "authoring prior not retirable"。
 */
export function validateParams(
  params: RatchetParams,
  ctx?: MemCtx,
): RatchetRejectReason[] {
  const errs: RatchetRejectReason[] = [];

  // C>0 是非发散保证下限（C=0 退化为无界增长）。
  if (typeof params.C !== "number" || !(params.C > 0)) {
    errs.push({
      ok: false,
      reason: "c_must_be_positive",
      msg: "C must be > 0 (bounded cap; C=0 degenerates to unbounded growth)",
    });
  }

  // authoring prior 不可退役（meta-skill authoring prior guard，L2-T10 委托）。
  // ctx 作为 side channel 携带退役尝试信号，避免反向硬依赖 T10 内部实现。
  const c = ctx as (MemCtx & { retireAuthoringPriorAttempt?: boolean }) | undefined;
  if (c?.retireAuthoringPriorAttempt === true) {
    errs.push({
      ok: false,
      reason: "authoring_prior_not_retirable",
      msg: "authoring prior not retirable (meta-skill prior guard)",
    });
  }

  return errs;
}
