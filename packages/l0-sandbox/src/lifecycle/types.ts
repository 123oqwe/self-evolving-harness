/**
 * L0S-T06 — sandbox 生命周期类型
 *
 * 硬 timeout + 并发上限 + finally{kill} + orphan list。
 * 机制 static-core；策略（maxConcurrent / hardTimeoutMs）由调用方注入。
 */

export interface TrackedSandbox {
  /** 进程组 leader 的 PID（调用方须以 `spawn(..., { detached: true })` 生成）。 */
  pid: number;
  /** 可选 socat proxy 子进程 PID（亦应为进程组 leader）。 */
  proxyPid?: number;
  /** 可选 worktree 工作目录绝对路径；teardown 时递归清理。 */
  worktreeCwd?: string;
  /** 所属 session，供 `teardownAll(sessionId)` 作用域清理。 */
  sessionId: string;
  /** best-effort 命令行（供 orphan list 报告）。 */
  cmd: string;
  /** 是否已被 teardown 清理。 */
  cleaned: boolean;
}

export interface AcquiredSlot {
  release: () => Promise<void>;
}

export interface OrphanReport {
  worktrees: string[];
  processes: { pid: number; cmd: string }[];
}
