import { describe, test, expect } from "vitest";
import { SandboxLifecycleManager } from "@harness/l0-sandbox";

/**
 * L0S-T06 · 正常路径（并发上限）
 * Spec G/W/T:
 *   Given `maxConcurrent=2`；
 *   When 2 个 `acquire()` 成功 + 第 3 个 await；
 *   Then 第 3 个在某个 release 后才 resolve。
 */

async function flush() {
  // Let pending microtasks + a couple of macrotasks settle so a queued
  // acquire() would have a chance to resolve if the semaphore were buggy.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("L0S-T06", () => {
  test("concurrency limit enforced", async () => {
    const mgr = new SandboxLifecycleManager({
      maxConcurrent: 2,
      hardTimeoutMs: 10_000,
    });

    const first = await mgr.acquire();
    const second = await mgr.acquire();

    let thirdResolved = false;
    const thirdPromise = mgr.acquire().then((handle) => {
      thirdResolved = true;
      return handle;
    });

    // While both slots are held, the third acquire must stay pending.
    await flush();
    expect(thirdResolved).toBe(false);

    // Releasing one slot must let the third acquire proceed.
    await first.release();
    const third = await thirdPromise;
    expect(thirdResolved).toBe(true);

    // After the third is held, a fourth must again block.
    let fourthResolved = false;
    const fourthPromise = mgr.acquire().then((handle) => {
      fourthResolved = true;
      return handle;
    });
    await flush();
    expect(fourthResolved).toBe(false);

    await second.release();
    const fourth = await fourthPromise;
    expect(fourthResolved).toBe(true);

    await third.release();
    await fourth.release();
  });
});
