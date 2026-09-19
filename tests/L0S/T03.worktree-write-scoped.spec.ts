import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveFsRules,
  isDenied,
  createWorktree,
  type FsRules,
  type ResolvedFsRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T03 · worktree 边界
 * Given createWorktree({repoRoot, branch:'sandbox-task', baseCommit})
 * When  sandbox 内写 /repo-outside-worktree/x
 * Then  EPERM（写局限于 worktree cwd subtree）
 *
 * spec：workspace vs repo 用 git worktree 解耦（C4）；
 * 写必须局限于 worktree cwd subtree，worktree 之外的路径一律 deny。
 */
describe("L0S-T03", () => {
  let repoRoot: string;
  let baseCommit: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "l0s-t03-wt-repo-"));
    // 构造一个最小可用的 git 仓库 + 一个 commit 作为 baseCommit
    execSync("git init -q -b main", { cwd: repoRoot });
    execSync('git config user.email "test@harness.local"', { cwd: repoRoot });
    execSync('git config user.name "Harness Test"', { cwd: repoRoot });
    writeFileSync(join(repoRoot, "README.md"), "baseline\n");
    execSync("git add README.md", { cwd: repoRoot });
    execSync("git commit -q -m baseline", { cwd: repoRoot });
    baseCommit = execSync("git rev-parse HEAD", { cwd: repoRoot })
      .toString()
      .trim();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("write limited to worktree cwd subtree", async () => {
    const { cwd: worktreeCwd, cleanup } = await createWorktree({
      repoRoot,
      branch: "sandbox-task",
      baseCommit,
    });

    try {
      // worktree cwd 必须真实存在且是目录
      expect(existsSync(worktreeCwd)).toBe(true);

      // FsRules：仅允许写 worktree cwd subtree，worktree 之外一律 deny
      const rules: FsRules = {
        allowWrite: [worktreeCwd],
        denyWrite: ["/"],
        denyRead: [],
        allowRead: [worktreeCwd],
      };
      const resolved: ResolvedFsRules = resolveFsRules(rules, worktreeCwd);

      // worktree 内写：放行
      const inside = isDenied(join(worktreeCwd, "x"), resolved, "write");
      expect(inside.denied).toBe(false);

      // worktree 之外写：拒绝（写局限于 worktree cwd subtree）
      const outside = isDenied("/repo-outside-worktree/x", resolved, "write");
      expect(outside.denied).toBe(true);
      expect(outside.reason).toMatch(/denyWrite/);
    } finally {
      await cleanup();
    }
  });

  test("createWorktree returns a detached worktree on the given baseCommit", async () => {
    const { cwd: worktreeCwd, cleanup } = await createWorktree({
      repoRoot,
      branch: "sandbox-task-2",
      baseCommit,
    });

    try {
      expect(existsSync(worktreeCwd)).toBe(true);
      // worktree 应挂在该 baseCommit 上（detached 或 branch at baseCommit）
      const head = execSync("git rev-parse HEAD", { cwd: worktreeCwd })
        .toString()
        .trim();
      expect(head).toBe(baseCommit);
    } finally {
      await cleanup();
    }

    // cleanup 后 worktree 目录应被移除
    expect(existsSync(worktreeCwd)).toBe(false);
  });
});
