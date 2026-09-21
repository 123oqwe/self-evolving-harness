/**
 * L0S-T07 — profile diff（收紧 vs 放宽判定）
 *
 * 裁决 L0S-06：tightened/relaxed 按字符串集合差集计算，fs deny 路径
 * （denyRead + denyWrite）与 syscall 名（syscalls.deny）混合：
 *   tightened = next 集合 - prev 集合
 *   relaxed   = prev 集合 - next 集合
 */

import type { SandboxProfile } from "./loader.js";

/** profile diff：收紧项（新增 deny）与放宽项（移除 deny）。 */
export interface ProfileDiff {
  tightened: string[];
  relaxed: string[];
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
 * 计算 prev → next 的 diff。
 * tightened = next - prev；relaxed = prev - next。
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
  return { tightened, relaxed };
}
