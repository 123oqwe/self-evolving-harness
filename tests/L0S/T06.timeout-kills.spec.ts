import { describe, test, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { SandboxLifecycleManager, TimeoutError } from "@harness/l0-sandbox";

/**
 * L0S-T06 · 边界（hard timeout）
 * Spec G/W/T:
 *   Given `runWithTimeout(fn, 1000)` fn 内 `sleep(5000)`；
 *   When 1000ms 到；
 *   Then throw `TimeoutError` + sandbox 子进程被 kill（`process.kill(pid, 'SIGKILL')`）。
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

describe("L0S-T06", () => {
  test("hard timeout kills sandbox process", async () => {
    const mgr = new SandboxLifecycleManager({
      maxConcurrent: 1,
      hardTimeoutMs: 1000,
    });

    // Simulate a long-lived sandbox child process. Spawn detached so it owns a
    // private process group — the manager kills via `process.kill(-pid)` and must
    // not take down the test runner's group.
    const child = spawn("node", ["-e", "setInterval(() => {}, 500)"], {
      stdio: "ignore",
      detached: true,
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error("failed to spawn child");

    try {
      mgr.trackSandbox({ pid, sessionId: "timeout-session" });

      // fn blocks forever (until the abort signal fires); it must NOT resolve
      // before the hard timeout elapses.
      const blocking = (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("aborted by signal")),
          );
        });

      // The hard timeout must reject with a TimeoutError instance.
      await expect(mgr.runWithTimeout(blocking, 200)).rejects.toSatisfy(
        (err: unknown) => err instanceof TimeoutError,
      );

      // The tracked sandbox child must have been killed.
      const exit = await waitForExit(child);
      expect(exit.code !== null || exit.signal !== null).toBe(true);

      // Process group is gone: signalling pid 0 must throw (ESRCH).
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      // Best-effort cleanup in case the implementation did not kill.
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  });
});
