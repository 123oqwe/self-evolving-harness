/**
 * L0S-T06 — 进程组清理工具
 *
 * 裁决 L0S-T06-A5：tracked `pid` 必须是进程组 leader（调用方以
 * `spawn(..., { detached: true })` 生成）。manager 用 `process.kill(-pid, 'SIGKILL')`
 * 杀整个进程组，孙进程一并清理。
 */

/** 杀整个进程组；若 pid 非 leader 或已死，回退到杀单个 pid。 */
export function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
    return;
  } catch {
    // 进程组可能已死 / pid 非 leader，回退。
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // 已死，忽略。
  }
}

/** pid 是否仍存活（信号 0 探测）。 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
