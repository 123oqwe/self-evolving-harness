import { describe, test, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { SandboxLifecycleManager } from "@harness/l0-sandbox";

/**
 * L0S-T06 · 错误路径（fn throw 仍 teardown）
 * Spec G/W/T:
 *   Given sandbox 进程 spawn 后 fn throw；
 *   When `teardownAll`；
 *   Then `finally{kill}` 保证 sandbox + proxy 子进程被 kill，`pgrep` 计数=0，
 *        worktree 清理（或归档为 orphan 记录）。
 */

interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<ExitInfo> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ code: child.exitCode, signal: child.signalCode }),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function spawnSimProcess(): ChildProcess {
  // detached so the manager's process-group kill is isolated from the runner.
  return spawn("node", ["-e", "setInterval(() => {}, 500)"], {
    stdio: "ignore",
    detached: true,
  });
}

describe("L0S-T06", () => {
  test("teardown runs even if fn throws", async () => {
    const mgr = new SandboxLifecycleManager({
      maxConcurrent: 1,
      hardTimeoutMs: 10_000,
    });

    const sandboxChild = spawnSimProcess();
    const proxyChild = spawnSimProcess();
    const sandboxPid = sandboxChild.pid;
    const proxyPid = proxyChild.pid;
    if (sandboxPid === undefined || proxyPid === undefined)
      throw new Error("failed to spawn children");

    try {
      mgr.trackSandbox({
        pid: sandboxPid,
        proxyPid: proxyPid,
        sessionId: "throw-session",
      });

      // runWithTimeout propagates the fn's throw; its finally must not swallow it.
      await expect(
        mgr.runWithTimeout(async () => {
          throw new Error("boom");
        }, 5000),
      ).rejects.toThrow("boom");

      // Per spec G/W/T, the caller runs teardownAll — it must kill both the
      // sandbox and the proxy child (finally{kill}).
      await mgr.teardownAll("throw-session");

      const sandboxExit = await waitForExit(sandboxChild);
      const proxyExit = await waitForExit(proxyChild);
      expect(sandboxExit.code !== null || sandboxExit.signal !== null).toBe(true);
      expect(proxyExit.code !== null || proxyExit.signal !== null).toBe(true);

      // No residual processes for this session: pgrep-equivalent count = 0.
      expect(() => process.kill(sandboxPid, 0)).toThrow();
      expect(() => process.kill(proxyPid, 0)).toThrow();

      // No orphans left behind after teardown.
      const orphans = mgr.listOrphans();
      expect(orphans.worktrees).toEqual([]);
      expect(orphans.processes).toEqual([]);
    } finally {
      for (const pid of [sandboxPid, proxyPid]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already dead
        }
      }
    }
  });
});
