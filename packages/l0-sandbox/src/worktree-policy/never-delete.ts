/**
 * L0S-T10 — never-auto-delete 守卫。
 *
 * 不变量：worktree 生命周期只允许 `archive`（mv 到 archive dir）与 `create`；
 * 任何 `delete` / `rm` / `git worktree remove` 等销毁操作均违反 never-auto-delete。
 *
 * 守卫审计操作日志（事后校验）而非运行时拦截——archive 操作先记录后执行，
 * 历史里出现销毁 op 即 throw。worst case = recoverable archive（可还原），
 * 绝不允许不可逆 delete。
 */

/** 操作日志条目（裁决 L0S-T10：`{ op, target, ts }`）。 */
export interface WorktreeHistoryEntry {
  /** 操作类型；合法值 `archive` / `create`，其余（`delete`/`rm`/`git worktree remove`…）均违规。 */
  op: string;
  /** 目标 worktree 路径。 */
  target: string;
  /** 操作时间戳（ms）。 */
  ts: number;
}

/** 合法（非销毁）操作集合。 */
const NON_DESTRUCTIVE_OPS = new Set<string>(["archive", "create"]);

/**
 * 校验操作日志无销毁操作。
 *
 * @throws 当历史中任一条目 `op` 不在 {archive, create} 时。
 */
export function assertNeverDelete(history: WorktreeHistoryEntry[]): void {
  for (const entry of history) {
    if (!NON_DESTRUCTIVE_OPS.has(entry.op)) {
      throw new Error(
        `never-auto-delete invariant violated: destructive op "${entry.op}" on "${entry.target}" (only archive/create allowed)`,
      );
    }
  }
}

/**
 * 统计操作日志中的销毁操作数（用于 `evaluate` 的 `neverDeleteViolations` oracle）。
 * 只读评估不产生销毁操作，故默认返回 0；保留以供运行时策略执行器复用。
 */
export function countNeverDeleteViolations(history: WorktreeHistoryEntry[]): number {
  let n = 0;
  for (const entry of history) {
    if (!NON_DESTRUCTIVE_OPS.has(entry.op)) n++;
  }
  return n;
}
