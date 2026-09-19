/**
 * L0S-T06 — 简单信号量并发上限
 *
 * `acquire()` 在活跃数达到 `maxConcurrent` 时排队等待，`release()` 后唤醒队首。
 */

import type { AcquiredSlot } from "./types.js";

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<AcquiredSlot> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active++;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.active--;
        const next = this.waiters.shift();
        if (next) next();
      },
    };
  }
}
