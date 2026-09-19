// L1-T15 · context mode 路由 + summarized handoff 模板进化（fork/fresh 不变量 static-core）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T15 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ContextModeRouter,
  FreshParentHistoryError,
  ForkPartialHistoryError,
  type ContextMode,
  type ContextModeRule,
  type ContextModeScore,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const HANDOFF_MD = `# Summary
## 未决 bug
<fill>
## 架构决策
<fill>
## modified-files
<list>
`;

function setup(root: string): RepoLock {
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts/summarized-handoff.md"), HANDOFF_MD, "utf8");
  return { versionSha: "k".repeat(40), files: [{ path: "prompts/summarized-handoff.md", sha256: sha(HANDOFF_MD) }] };
}

function cscore(o: Partial<ContextModeScore>): ContextModeScore {
  return { acceptanceInBudget: o.acceptanceInBudget ?? 0.5, redoRate: o.redoRate ?? 0.2, isBaseline: o.isBaseline ?? false };
}

describe("L1-T15", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t15-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("route returns fresh for review-type task", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const router = new ContextModeRouter({ repo });
    const mode = router.route({ taskType: "code-review", needsParentBackground: false });
    expect(mode).toBe("fresh");
  });

  it("assertFreshNoParentHistory throws when fresh loads parent history", () => {
    const router = new ContextModeRouter({} as never);
    expect(() => router.assertFreshNoParentHistory("fresh", true)).toThrowError(FreshParentHistoryError);
    // fork 加载 parent history 是允许的
    expect(() => router.assertFreshNoParentHistory("fork", true)).not.toThrow();
  });

  it("assertForkFullHistory throws when fork copies partial", () => {
    const router = new ContextModeRouter({} as never);
    expect(() => router.assertForkFullHistory("fork", "partial")).toThrowError(ForkPartialHistoryError);
    expect(() => router.assertForkFullHistory("fork", "full")).not.toThrow();
  });

  it("evolve improves acceptanceInBudget ∧ redoRate", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const router = new ContextModeRouter({ repo });
    const baseline = cscore({ isBaseline: true, acceptanceInBudget: 0.5, redoRate: 0.3 });
    const cand = cscore({ acceptanceInBudget: 0.6, redoRate: 0.2 });
    const rules: ContextModeRule[] = [{ features: { taskType: "code-review" }, mode: "fresh" as ContextMode }];
    const result = router.evolve(rules, HANDOFF_MD, [baseline, cand]);
    // 双改善 → 候选入选（evolved template 应反映改善方向）
    expect(result.template).toBeTruthy();
    expect(result.router.length).toBeGreaterThan(0);
  });

  it("evolve summarized template adds field with redoRate↓", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const router = new ContextModeRouter({ repo });
    const baseline = cscore({ isBaseline: true, acceptanceInBudget: 0.5, redoRate: 0.3 });
    const cand = cscore({ acceptanceInBudget: 0.55, redoRate: 0.1 });
    const rules: ContextModeRule[] = [{ features: { taskType: "research" }, mode: "summarized" as ContextMode }];
    const result = router.evolve(rules, HANDOFF_MD, [baseline, cand]);
    // 模板进化允许加字段且 redoRate↓
    expect(result.template.length).toBeGreaterThanOrEqual(HANDOFF_MD.length);
  });
});
