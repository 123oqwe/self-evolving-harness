import { describe, test, expect } from "vitest";
import { WorktreePolicyRegistry } from "@harness/l0-sandbox";

/**
 * L0S-T10 · 边界（never-auto-delete）
 *
 * Spec G/W/T:
 *   Given 一个 worktree 达 archive 阈值；
 *   When  policy 执行归档；
 *   Then  归档（move 到 archive dir），非 delete，assertNeverDelete 通过。
 *   Given policy 含 delete 操作；
 *   When  assertNeverDelete；Then throw。
 *
 * never-delete 守卫审计操作日志而非运行时拦截（archive 操作先记录后执行）。
 * WorktreeHistory 形状见 ambiguities；此处采用 { op, target, ts } 形状。
 */
describe("L0S-T10", () => {
  test("archive not delete enforced", () => {
    const reg = new WorktreePolicyRegistry();

    // 仅含 archive（mv）操作的历史 → 通过。
    const archived = [
      { op: "archive", target: "/wt/a", ts: 1 },
      { op: "archive", target: "/wt/b", ts: 2 },
    ];
    expect(() => reg.assertNeverDelete(archived as never)).not.toThrow();

    // 含 delete（rm / git worktree remove）操作的历史 → throw。
    const deleted = [
      { op: "archive", target: "/wt/a", ts: 1 },
      { op: "delete", target: "/wt/b", ts: 2 },
    ];
    expect(() => reg.assertNeverDelete(deleted as never)).toThrow();

    // spec 明确「校验无 rm / git worktree remove，仅 mv 到 archive」。
    const rmHistory = [
      { op: "archive", target: "/wt/a", ts: 1 },
      { op: "rm", target: "/wt/b", ts: 2 },
    ];
    expect(() => reg.assertNeverDelete(rmHistory as never)).toThrow();

    const removeHistory = [
      { op: "archive", target: "/wt/a", ts: 1 },
      { op: "git worktree remove", target: "/wt/b", ts: 2 },
    ];
    expect(() => reg.assertNeverDelete(removeHistory as never)).toThrow();
  });
});
