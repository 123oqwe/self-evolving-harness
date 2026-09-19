/**
 * L0S-T03 — worktree 隔离（git worktree add --detach）+ baseline。
 *
 * 裁决 L0S-T03-A4：createWorktree 用 `git worktree add --detach <cwd> <baseCommit>`，
 * worktree HEAD 直接位于 baseCommit（满足 `git rev-parse HEAD === baseCommit`）。
 * `branch` 选项仅作逻辑标签/清理跟踪用，**不检出为分支**（消除 spec 矛盾）。
 *
 * 裁决 L0S-T03-A6：写局限于 worktree cwd subtree **由 FsRules 表达**
 * （`allowWrite=[cwd]`, `denyWrite=['/']`），createWorktree 本身不独立强制写范围。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CreateWorktreeOpts {
  /** 宿主 git 仓库根目录。 */
  repoRoot: string;
  /** 逻辑标签/清理跟踪用，不检出为分支（A4）。 */
  branch: string;
  /** worktree HEAD 挂载点（detached）。 */
  baseCommit: string;
}

export interface WorktreeHandle {
  /** worktree 工作目录（detached at baseCommit）。 */
  cwd: string;
  /** 清理：移除 worktree + prune + 删除临时目录。幂等，错误吞掉。 */
  cleanup: () => Promise<void>;
}

/**
 * 创建 detached git worktree at baseCommit。
 * 在 tmpdir 下建临时父目录，worktree 落 `<parent>/wt`，git 自行创建该子目录。
 */
export async function createWorktree(
  opts: CreateWorktreeOpts,
): Promise<WorktreeHandle> {
  const { repoRoot, baseCommit } = opts;
  const parent = mkdtempSync(join(tmpdir(), "l0s-worktree-"));
  const cwd = join(parent, "wt");

  try {
    execFileSync(
      "git",
      ["worktree", "add", "--detach", cwd, baseCommit],
      { cwd: repoRoot, stdio: "ignore" },
    );
  } catch (e) {
    rmSync(parent, { recursive: true, force: true });
    throw e;
  }

  const cleanup = async (): Promise<void> => {
    try {
      execFileSync(
        "git",
        ["worktree", "remove", "--force", cwd],
        { cwd: repoRoot, stdio: "ignore" },
      );
    } catch {
      // 忽略：worktree 可能已被外部移除
    }
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: repoRoot,
        stdio: "ignore",
      });
    } catch {
      // 忽略 prune 失败
    }
    rmSync(parent, { recursive: true, force: true });
  };

  return { cwd, cleanup };
}
