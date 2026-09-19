import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorktreePolicyRegistry, type WorktreePolicy } from "@harness/l0-sandbox";

/**
 * L0S-T10 · 错误路径/正常（diff 存在 oracle）
 *
 * Spec G/W/T（diff-exists oracle）：
 *   Given 一次 feature run 在 worktree 内产生未提交改动；
 *   When  evaluate；
 *   Then  diffExistsRatio > 0（run 产生可评审 diff）。
 */
function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

describe("L0S-T10", () => {
  let repo: string;
  let reg: WorktreePolicyRegistry;
  let wt: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "l0s-t10-diff-"));
    git(repo, "init -q -b main");
    git(repo, "config user.email t@t"); git(repo, "config user.name t");
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, "add .");
    git(repo, 'commit -q -m init');

    // 一个带未提交改动的 worktree（diff 存在）。
    wt = join(repo, "..", `wt-diff-${process.pid}`);
    git(repo, `worktree add -q --detach "${wt}"`);
    writeFileSync(join(wt, "feature.txt"), "new feature\n");

    reg = new WorktreePolicyRegistry();
  });

  afterEach(() => {
    // 先 prune 元数据，再删除残留的 linked worktree 目录（位于 repo/.. 旁路）。
    try { git(repo, "worktree prune"); } catch { /* noop */ }
    rmSync(wt, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  test("run produces reviewable diff", () => {
    const policy: WorktreePolicy = {
      version: "v1",
      staleAfterDays: 30,
      archiveAfterDays: 90,
      granularity: "per-task",
      cowStrategy: "checkout",
    };

    const r = reg.evaluate(policy, repo);

    expect(r.diffExistsRatio).toBeGreaterThan(0);
    expect(r.neverDeleteViolations).toBe(0);
  });
});
