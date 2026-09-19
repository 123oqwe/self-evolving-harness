/**
 * L0S-T06 — 硬 timeout + AbortController dispose
 *
 * TimeoutError 须由包导出（裁决 L0S-T06-A4），供测试 `instanceof` 断言。
 */

export class TimeoutError extends Error {
  constructor(message = "sandbox hard timeout exceeded") {
    super(message);
    this.name = "TimeoutError";
  }
}
