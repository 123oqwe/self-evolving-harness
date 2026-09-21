/**
 * L0S-T07 — 单调收紧守卫
 *
 * 放宽（relaxed 非空）→ throw（须人工签发，防 agent 自放宽 deny）。
 * 相等（tightened 与 relaxed 均空）合法（裁决 L0S-17：允许持平）。
 */

import type { ProfileDiff } from "./diff.js";

/**
 * 断言 diff 为单调收紧方向：relaxed 必须为空，且 allow 侧不得新增
 * （allowAdded 必须为空）。
 *
 * deny 侧：relaxed 非空 → throw（须人工签发，防 agent 自放宽 deny）。
 * allow 侧：allowAdded 非空 → throw。rules.ts 的 isDenied 语义里 allow
 * 前缀可重开（carve out）更宽的 deny 前缀（A2 narrower-allow-reopens-
 * wider-deny），故新增 allow 条目可在 deny 集合不变、relaxed=[] 的情况下
 * 实质性放宽沙箱。allow 只许减不许增——allow 侧同样锁死单调收紧。
 * 相等（四列表均空）合法（裁决 L0S-17：允许持平）。
 *
 * @throws relaxed 非空 或 allowAdded 非空 时 throw
 */
export function assertMonotonicTighten(diff: ProfileDiff): void {
  if (diff.relaxed.length > 0) {
    throw new Error(
      `monotonic tighten violated: relaxed denies=${JSON.stringify(diff.relaxed)} (需人工签发)`,
    );
  }
  if (diff.allowAdded.length > 0) {
    throw new Error(
      `monotonic tighten violated: allow added=${JSON.stringify(diff.allowAdded)} (allow 可重开 wider deny 前缀, 只许减不许增; 需人工签发)`,
    );
  }
}
