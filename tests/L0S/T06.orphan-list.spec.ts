import { describe, test, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxLifecycleManager } from "@harness/l0-sandbox";

/**
 * L0S-T06 · orphan list 边界
 * Spec G/W/T:
 *   Given 一个 sandbox 进程被外部 kill -9（teardown 未执行）；
 *   When `listOrphans()`；
 *   Then 报告该 worktree + 残留进程（`pgrep -f bwrap`/`pgrep -f socat`）。
 *
 * Implementation hint from spec: "orphan list 测试用 mock `pgrep` 避免依赖真实进程".
 * The listOrphans() signature takes no args, so the manager is expected to
 * report tracked-but-unteardown sandboxes (worktreeCwd still present + tracked
 * pid still alive) — see ambiguities reported for this task.
 */

function spawnSimProcess(): ChildProcess {
  return spawn("node", ["-e", "setInterval(() => {}, 500)"], {
    stdio: "ignore",
    detached: true,
  });
}

const leftover: { pid?: number; dir?: string } = {};

afterEach(() => {
  if (leftover.pid !== undefined) {
    try {
      process.kill(leftover.pid, "SIGKILL");
    } catch {
      // dead
    }
  }
  if (leftover.dir) {
    rmSync(leftover.dir, { recursive: true, force: true });
  }
  leftover.pid = undefined;
  leftover.dir = undefined;
});

describe("L0S-T06", () => {
  test("orphan list detects leftover worktree+process", async () => {
    const mgr = new SandboxLifecycleManager({
      maxConcurrent: 1,
      hardTimeoutMs: 10_000,
    });

    // A live sandbox process whose teardown was never run.
    const child = spawnSimProcess();
    const pid = child.pid;
    if (pid === undefined) throw new Error("failed to spawn child");
    leftover.pid = pid;

    // A leftover worktree directory (tracked but not cleaned up).
    const worktreeCwd = mkdtempSync(join(tmpdir(), "l0s-orphan-wt-"));
    leftover.dir = worktreeCwd;

    mgr.trackSandbox({
      pid,
      worktreeCwd,
      sessionId: "orphan-session",
    });

    // teardown NOT executed — this is the orphan condition.
    const orphans = mgr.listOrphans();

    // The leftover worktree must be reported.
    expect(orphans.worktrees).toContain(worktreeCwd);

    // The leftover process must be reported with a non-empty command line.
    const procEntry = orphans.processes.find((p) => p.pid === pid);
    expect(procEntry).toBeDefined();
    expect(typeof procEntry?.cmd).toBe("string");
    expect(procEntry?.cmd.length).toBeGreaterThan(0);

    // Sanity: once torn down, the orphan is cleared.
    await mgr.teardownAll("orphan-session");
    leftover.pid = undefined; // teardown killed it; don't double-kill
    const after = mgr.listOrphans();
    expect(after.worktrees).not.toContain(worktreeCwd);
    expect(after.processes.find((p) => p.pid === pid)).toBeUndefined();
  });
});
