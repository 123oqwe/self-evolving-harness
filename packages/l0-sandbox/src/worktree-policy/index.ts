/**
 * L0S-T10 — C4 worktree 生命周期/粒度/COW 进化策略注册表。
 *
 * 文件布局（spec L0S-T10）：
 *   - index.ts        — WorktreePolicyRegistry（本文件）+ 类型
 *   - oracles.ts      — 孤儿数 / 冲突率 / diff 存在比 oracle
 *   - never-delete.ts — never-auto-delete 守卫（archive 非 delete）
 *
 * 行为：
 *   - 正常路径：policy v2 收紧 staleAfterDays 30→15 → 更积极归档 → orphanCount 下降。
 *   - 边界（never-auto-delete）：达 archive 阈值的 worktree 被 archive（mv），
 *     非 delete；`assertNeverDelete` 通过。
 *   - 错误路径：操作日志含 delete/rm/git worktree remove → `assertNeverDelete` throw。
 */

import {
  computeOrphanCount,
  computeConflictRate,
  computeDiffExistsRatio,
} from "./oracles.js";
import {
  assertNeverDelete as assertNeverDeleteImpl,
  type WorktreeHistoryEntry,
} from "./never-delete.js";

/** worktree 策略表（可进化；static-core runtime 只读）。 */
export interface WorktreePolicy {
  version: string;
  staleAfterDays: number;
  archiveAfterDays: number;
  granularity: "per-feature" | "per-task" | "per-subagent";
  cowStrategy: "overlay" | "checkout";
}

/** 操作日志条目（与 never-delete.ts WorktreeHistoryEntry 同形）。 */
export type WorktreeHistory = WorktreeHistoryEntry;

/** `evaluate` 返回的 oracle 指标。 */
export interface WorktreeEvalResult {
  /** 悬留孤儿数（陈旧未归档）。 */
  orphanCount: number;
  /** 冲突率（0..1）。 */
  conflictRate: number;
  /** diff 存在比（0..1）。 */
  diffExistsRatio: number;
  /** never-auto-delete 违规数（read-only evaluate 恒为 0）。 */
  neverDeleteViolations: number;
}

export type { WorktreeHistoryEntry } from "./never-delete.js";
export { listLinkedWorktrees, computeOrphanCount, computeConflictRate, computeDiffExistsRatio } from "./oracles.js";

/**
 * C4 worktree 策略注册表。
 *
 * `evaluate`：read-only 评估——基于 fixture repo 的实际 `git worktree` 状态
 * 计算 oracle 指标，不执行任何归档/销毁操作，故 `neverDeleteViolations=0`。
 *
 * `assertNeverDelete`：审计操作日志，销毁 op → throw。
 */
export class WorktreePolicyRegistry {
  /**
   * 评估 policy 对 fixture repo 的效果。
   *
   * 只读：不归档、不删除；仅据 worktree 当前 mtime 与改动状态计算指标。
   */
  evaluate(
    policy: WorktreePolicy,
    fixtureRepo: string,
  ): WorktreeEvalResult {
    return {
      orphanCount: computeOrphanCount(policy, fixtureRepo),
      conflictRate: computeConflictRate(fixtureRepo),
      diffExistsRatio: computeDiffExistsRatio(fixtureRepo),
      neverDeleteViolations: 0,
    };
  }

  /**
   * 校验操作日志满足 never-auto-delete 不变量。
   *
   * @throws 当历史含 `delete`/`rm`/`git worktree remove` 等销毁 op 时。
   */
  assertNeverDelete(history: WorktreeHistory[]): void {
    assertNeverDeleteImpl(history);
  }
}
