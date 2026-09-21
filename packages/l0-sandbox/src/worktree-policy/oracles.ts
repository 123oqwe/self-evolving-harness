/**
 * L0S-T10 — worktree 策略 oracle：孤儿数 / 冲突率 / diff 存在比。
 *
 * 数据源（裁决 L0S-T10）：`git worktree list --porcelain` 差集算孤儿数；
 * `git status --porcelain` 算 diff 存在；`git diff --diff-filter=U` 算冲突率。
 *
 * age 计算 = worktree 目录 mtime（非 last-commit date）；
 * 陈旧判定 = `Date.now() - mtime > staleAfterDays*86400000`。
 *
 * orphan 语义与 L0S-T06 `listOrphans` 对齐：orphan = tracked 但未 teardown 的
 * worktree。本 oracle 面向 policy 评估：worktree 陈旧（age > staleAfterDays）
 * 且尚未归档（age <= archiveAfterDays）即计为孤儿——已归档者不再悬留。
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import type { WorktreePolicy } from "./index.js";

const MS_PER_DAY = 86_400_000;

function git(cwd: string, args: string): string {
  return execFileSync("git", args.split(/\s+/), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

/** 列出 fixture repo 的所有 linked worktree（排除 main worktree）。 */
export function listLinkedWorktrees(fixtureRepo: string): string[] {
  let out: string;
  try {
    out = git(fixtureRepo, "worktree list --porcelain");
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      const p = line.slice("worktree ".length).trim();
      if (p.length > 0 && p !== fixtureRepo) paths.push(p);
    }
  }
  return paths;
}

/**
 * 孤儿数 oracle。
 *
 * orphan = age > staleAfterDays（陈旧）且 age <= archiveAfterDays（尚未归档）。
 * 收紧归档阈值（archiveAfterDays ↓）使更多陈旧 worktree 落入「已归档」区间，
 * 从而降低悬留孤儿数。
 */
export function computeOrphanCount(policy: WorktreePolicy, fixtureRepo: string): number {
  const wts = listLinkedWorktrees(fixtureRepo);
  const now = Date.now();
  const staleMs = policy.staleAfterDays * MS_PER_DAY;
  const archiveMs = policy.archiveAfterDays * MS_PER_DAY;
  let orphans = 0;
  for (const wt of wts) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(wt).mtimeMs;
    } catch {
      // 目录不可访问——视为已 teardown，跳过。
      continue;
    }
    const age = now - mtimeMs;
    if (age > staleMs && age <= archiveMs) orphans++;
  }
  return orphans;
}

/**
 * diff 存在比 oracle。
 *
 * ratio = 有未提交改动（含 untracked）的 linked worktree 数 / 总 linked worktree 数。
 * 用于验证一次 feature run 产出可评审 diff。
 */
export function computeDiffExistsRatio(fixtureRepo: string): number {
  const wts = listLinkedWorktrees(fixtureRepo);
  if (wts.length === 0) return 0;
  let withDiff = 0;
  for (const wt of wts) {
    try {
      const status = execFileSync(
        "git",
        ["status", "--porcelain"],
        { cwd: wt, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
      if (status.trim().length > 0) withDiff++;
    } catch {
      // git 不可用——保守计为无 diff。
    }
  }
  return withDiff / wts.length;
}

/**
 * 冲突率 oracle。
 *
 * ratio = 存在未合并文件（`git diff --diff-filter=U`）的 linked worktree 数 / 总数。
 */
export function computeConflictRate(fixtureRepo: string): number {
  const wts = listLinkedWorktrees(fixtureRepo);
  if (wts.length === 0) return 0;
  let conflicts = 0;
  for (const wt of wts) {
    try {
      const unmerged = execFileSync(
        "git",
        ["diff", "--name-only", "--diff-filter=U"],
        { cwd: wt, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
      if (unmerged.trim().length > 0) conflicts++;
    } catch {
      // git 不可用——保守计为无冲突。
    }
  }
  return conflicts / wts.length;
}
