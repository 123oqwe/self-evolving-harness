/**
 * L0S-T07 — profile diff（收紧 vs 放宽判定）
 *
 * 裁决 L0S-06：tightened/relaxed 按字符串集合差集计算，fs deny 路径
 * （denyRead + denyWrite）与 syscall 名（syscalls.deny）混合：
 *   tightened = next 集合 - prev 集合
 *   relaxed   = prev 集合 - next 集合
 */

import type { SandboxProfile } from "./loader.js";

/**
 * profile diff：收紧项（新增 deny）与放宽项（移除 deny），外加 allow 侧
 * 变更（allowAdded / allowRemoved）。
 *
 * allow 侧校验是单调收紧不变量的必要补全：rules.ts 的 isDenied 语义里
 * allow 前缀可重开（carve out）更宽的 deny 前缀（A2 narrower-allow-reopens-
 * wider-deny）。因此仅在 deny 侧聚合 relaxed 还不够——进化 profile 只要在
 * allowRead/allowWrite 新增条目即可在 deny 集合不变、relaxed=[] 的情况下
 * 实质性放宽沙箱。allowAdded 非空即视为放宽（allow 只许减不许增）。
 */
export interface ProfileDiff {
  /** deny 新增（收紧方向）。 */
  tightened: string[];
  /** deny 移除（放宽方向）。 */
  relaxed: string[];
  /** allow 新增（实质性放宽：可 carve out 更宽的 deny 前缀）。 */
  allowAdded: string[];
  /** allow 移除（收紧方向：撤回既有 carve-out）。 */
  allowRemoved: string[];
}

/** 合并 profile 的全部 deny 字符串（fs deny 路径 + syscall 名）为集合。 */
function denySet(p: SandboxProfile): Set<string> {
  const s = new Set<string>();
  for (const x of p.fs.denyRead) s.add(x);
  for (const x of p.fs.denyWrite) s.add(x);
  for (const x of p.syscalls.deny) s.add(x);
  return s;
}

/**
 * 合并 profile 的全部 allow 字符串（allowRead + allowWrite 路径）为集合。
 *
 * allow 前缀可重开（carve out）更宽的 deny 前缀（A2），故 allow 侧须与
 * deny 侧同受单调收紧约束：allow 只许减不许增。
 */
function allowSet(p: SandboxProfile): Set<string> {
  const s = new Set<string>();
  for (const x of p.fs.allowRead) s.add(x);
  for (const x of p.fs.allowWrite) s.add(x);
  return s;
}

/**
 * 计算 prev → next 的 diff。
 * tightened = next deny - prev deny；relaxed = prev deny - next deny；
 * allowAdded = next allow - prev allow；allowRemoved = prev allow - next allow。
 */
export function diffProfiles(
  prev: SandboxProfile,
  next: SandboxProfile,
): ProfileDiff {
  const a = denySet(prev);
  const b = denySet(next);
  const tightened: string[] = [];
  const relaxed: string[] = [];
  for (const x of b) if (!a.has(x)) tightened.push(x);
  for (const x of a) if (!b.has(x)) relaxed.push(x);

  const pa = allowSet(prev);
  const pb = allowSet(next);
  const allowAdded: string[] = [];
  const allowRemoved: string[] = [];
  for (const x of pb) if (!pa.has(x)) allowAdded.push(x);
  for (const x of pa) if (!pb.has(x)) allowRemoved.push(x);

  return { tightened, relaxed, allowAdded, allowRemoved };
}
