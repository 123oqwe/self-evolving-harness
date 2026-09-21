/**
 * L0S-T07 — 单调收紧守卫
 *
 * 放宽（relaxed 非空）→ throw（须人工签发，防 agent 自放宽 deny）。
 * 相等（tightened 与 relaxed 均空）合法（裁决 L0S-17：允许持平）。
 */

import type { ProfileDiff } from "./diff.js";

/**
 * 断言 diff 为单调收紧方向：relaxed 必须为空。
 * @throws relaxed 非空时 throw
 */
export function assertMonotonicTighten(diff: ProfileDiff): void {
  if (diff.relaxed.length > 0) {
    throw new Error(
      `monotonic tighten violated: relaxed denies=${JSON.stringify(diff.relaxed)} (需人工签发)`,
    );
  }
}
