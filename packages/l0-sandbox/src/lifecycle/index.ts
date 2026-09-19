/**
 * L0S-T06 — SandboxLifecycleManager
 *
 * sandbox 子进程 + socat proxy 进程的生命周期管理：
 *   - 硬 timeout 强制 kill（进程组 SIGKILL）
 *   - 并发上限信号量
 *   - `finally{kill}` teardown
 *   - orphan list（tracked 但未 teardown 的 sandbox）
 *
 * 裁决 L0S-T06-A1：`runWithTimeout(fn, timeoutMs)` 无 sessionId 形参。timeout 或
 * fn throw 时，manager 在 throw 前对**当前实例上已 trackSandbox 注册的全部
 * sandbox** 执行进程组 kill（`process.kill(-pid, 'SIGKILL')`），不区分 session。
 * session 维度清理走 `teardownAll(sessionId)`（调用方在 finally 调）。
 */

import { rmSync } from "node:fs";
export type {
  TrackedSandbox,
  AcquiredSlot,
  OrphanReport,
} from "./types.js";
export { TimeoutError } from "./timeout.js";
import { Semaphore } from "./concurrency.js";
import { buildOrphanReport, readProcessCmd } from "./orphan-list.js";
import { TimeoutError } from "./timeout.js";
import { killProcessGroup } from "./teardown.js";
import type { AcquiredSlot, OrphanReport, TrackedSandbox } from "./types.js";

export interface SandboxLifecycleManagerOptions {
  maxConcurrent: number;
  hardTimeoutMs: number;
}

export interface TrackSandboxInput {
  pid: number;
  proxyPid?: number;
  worktreeCwd?: string;
  sessionId: string;
}

export class SandboxLifecycleManager {
  private readonly semaphore: Semaphore;
  private readonly hardTimeoutMs: number;
  private readonly registry: TrackedSandbox[] = [];

  constructor(opts: SandboxLifecycleManagerOptions) {
    this.semaphore = new Semaphore(opts.maxConcurrent);
    this.hardTimeoutMs = opts.hardTimeoutMs;
  }

  /** 信号量：acquire 一个并发槽，返回 release 句柄。 */
  acquire(): Promise<AcquiredSlot> {
    return this.semaphore.acquire();
  }

  /**
   * 注册一个 sandbox（含子进程组 leader pid + 可选 proxy pid + 可选 worktree
   * cwd）。pid 必须为进程组 leader（`spawn(..., { detached: true })`）。
   */
  trackSandbox(sandbox: TrackSandboxInput): void {
    const cmd = readProcessCmd(sandbox.pid);
    const entry: TrackedSandbox = {
      pid: sandbox.pid,
      sessionId: sandbox.sessionId,
      cmd,
      cleaned: false,
    };
    if (sandbox.proxyPid !== undefined) {
      entry.proxyPid = sandbox.proxyPid;
    }
    if (sandbox.worktreeCwd !== undefined) {
      entry.worktreeCwd = sandbox.worktreeCwd;
    }
    this.registry.push(entry);
  }

  /**
   * 在硬 timeout / fn throw 约束下运行 fn。
   *
   * - timeout 到期：abort signal + kill 当前实例上全部 tracked sandbox 进程组
   *   + reject TimeoutError。
   * - fn throw：kill 当前实例上全部 tracked sandbox 进程组 + 透传原 error。
   *
   * 裁决 A1：不区分 session（session 维度清理走 `teardownAll`）。
   */
  async runWithTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const ac = new AbortController();
    const effectiveTimeout = timeoutMs > 0 ? timeoutMs : this.hardTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // 先 kill + reject(TimeoutError)，再 abort signal——确保 race 以
        // TimeoutError 定案，而非 fn 的 abort-listener reject 抢先（abort
        // listener 在 ac.abort() 时同步触发）。
        this.killAllTracked();
        reject(new TimeoutError());
        ac.abort();
      }, effectiveTimeout);
    });
    try {
      return await Promise.race([fn(ac.signal), timeout]);
    } catch (e) {
      if (!(e instanceof TimeoutError)) {
        // fn 先于 timeout 抛出：finally{kill} 语义。
        this.killAllTracked();
      }
      throw e;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * session 维度 teardown：对该 session 内全部 tracked sandbox 执行进程组
   * kill + 递归清理 worktree cwd + 标记 cleaned（移出 orphan 报告）。
   */
  async teardownAll(sessionId: string): Promise<void> {
    for (const s of this.registry) {
      if (s.sessionId !== sessionId) continue;
      killProcessGroup(s.pid);
      if (s.proxyPid !== undefined) {
        killProcessGroup(s.proxyPid);
      }
      if (s.worktreeCwd !== undefined) {
        try {
          rmSync(s.worktreeCwd, { recursive: true, force: true });
        } catch {
          // 目录已不存在 / 不可访问，忽略。
        }
      }
      s.cleaned = true;
    }
  }

  /**
   * orphan list：从内部 tracked-sandbox 注册表报告 tracked 但未 teardown 的
   * sandbox（worktreeCwd 仍存在 OR pid 仍存活）。裁决 A2：无形参，不走 pgrep。
   */
  listOrphans(): OrphanReport {
    return buildOrphanReport(this.registry);
  }

  /** kill 当前实例上全部 tracked sandbox 进程组（不清 worktree / 不移除注册表）。 */
  private killAllTracked(): void {
    for (const s of this.registry) {
      killProcessGroup(s.pid);
      if (s.proxyPid !== undefined) {
        killProcessGroup(s.proxyPid);
      }
    }
  }
}
