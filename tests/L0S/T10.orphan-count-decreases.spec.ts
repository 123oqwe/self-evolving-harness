import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorktreePolicyRegistry, type WorktreePolicy } from "@harness/l0-sandbox";

/**
 * L0S-T10 · 正常路径（孤儿数）
 *
 * Spec G/W/T:
 *   Given policy v2 收紧 staleAfterDays 30→15；
 *   When  evaluate；
 *   Then  orphanCount 较 v1 下降（更积极归档），neverDeleteViolations=0。
 */

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function makeFixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "l0s-t10-repo-"));
  git(repo, "init -q -b main");
  git(repo, 'config user.email t@t'); git(repo, 'config user.name t');
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add .");
  git(repo, 'commit -q -m init');
  return repo;
}

function addWorktree(repo: string, name: string, stale: boolean): string {
  const wt = join(repo, "..", `wt-${name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  git(repo, `worktree add -q --detach "${wt}"`);
  // 在 worktree 内制造一点未提交改动（保证 diff 存在）。
  writeFileSync(join(wt, `${name}.txt`), `${name} work\n`);
  if (stale) {
    // 把 worktree 目录 mtime 设到 60 天前，模拟陈旧孤儿。
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    utimesSync(wt, old, old);
  }
  return wt;
}

describe("L0S-T10", () => {
  let repo: string;
  let reg: WorktreePolicyRegistry;
  let wts: string[];

  beforeEach(() => {
    repo = makeFixtureRepo();
    reg = new WorktreePolicyRegistry();
    wts = [];
  });

  afterEach(() => {
    // 先 prune 元数据，再删除残留的 linked worktree 目录（它们位于 repo/.. 旁路）。
    try { git(repo, "worktree prune"); } catch { /* noop */ }
    for (const wt of wts) {
      rmSync(wt, { recursive: true, force: true });
    }
    rmSync(repo, { recursive: true, force: true });
  });

  test("tighter stale policy reduces orphan count", () => {
    // 两个陈旧 worktree + 一个新鲜 worktree。
    wts.push(addWorktree(repo, "stale1", true));
    wts.push(addWorktree(repo, "stale2", true));
    wts.push(addWorktree(repo, "fresh", false));

    const v1: WorktreePolicy = {
      version: "v1",
      staleAfterDays: 30,
      archiveAfterDays: 90,
      granularity: "per-task",
      cowStrategy: "checkout",
    };
    const v2: WorktreePolicy = {
      version: "v2",
      staleAfterDays: 15,
      archiveAfterDays: 15,
      granularity: "per-task",
      cowStrategy: "checkout",
    };

    const r1 = reg.evaluate(v1, repo);
    const r2 = reg.evaluate(v2, repo);

    expect(r1.neverDeleteViolations).toBe(0);
    expect(r2.neverDeleteViolations).toBe(0);
    // v1 下两个陈旧 worktree 必须被计为孤儿（阻断「恒返回 0」空壳实现）。
    expect(r1.orphanCount).toBeGreaterThanOrEqual(2);
    // spec：收紧归档策略后孤儿数「下降」（更积极归档）→ 严格小于。
    expect(r2.orphanCount).toBeLessThan(r1.orphanCount);
  });
});
