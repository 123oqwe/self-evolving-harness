/**
 * L0S-T06 — orphan worktree/进程 list
 *
 * 裁决 L0S-T06-A2/A3：`listOrphans()` 无形参，从 manager 内部 tracked-sandbox
 * 注册表报告（**不**走 `pgrep` / `git worktree list`）。一个 sandbox 被报告为
 * orphan 当且仅当：已 `trackSandbox` 注册**且** `teardownAll` 未对其清理**且**
 * （`worktreeCwd` 仍存在 OR `pid` 仍存活）。「拋留进程」= tracked pid 仍存活的进程。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isProcessAlive } from "./teardown.js";
import type { OrphanReport, TrackedSandbox } from "./types.js";

/** best-effort 读取 pid 命令行；失败回退非空标签。 */
export function readProcessCmd(pid: number): string {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length > 0) return out;
  } catch {
    // 进程已死 / ps 不可用，回退。
  }
  return `sandbox-pid:${pid}`;
}

/** 从 tracked-sandbox 注册表构建 orphan 报告。 */
export function buildOrphanReport(tracked: Iterable<TrackedSandbox>): OrphanReport {
  const worktrees: string[] = [];
  const processes: { pid: number; cmd: string }[] = [];
  for (const s of tracked) {
    if (s.cleaned) continue;
    const worktreeExists = s.worktreeCwd !== undefined && existsSync(s.worktreeCwd);
    const pidAlive = isProcessAlive(s.pid);
    if (!worktreeExists && !pidAlive) continue;
    if (worktreeExists && s.worktreeCwd !== undefined) {
      worktrees.push(s.worktreeCwd);
    }
    if (pidAlive) {
      processes.push({ pid: s.pid, cmd: s.cmd });
    }
  }
  return { worktrees, processes };
}
