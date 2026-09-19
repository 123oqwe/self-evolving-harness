/**
 * L0S-T03 — FsRules → seatbelt/bwrap profile 片段生成。
 *
 * 机制 static-core；策略进化（profiles/v{n}.yaml）推迟到 T07。
 * 本模块仅提供把 ResolvedFsRules 渲染为各后端 profile 片段的纯函数，
 * 供 T02 后端在组装完整 profile 时拼接。
 *
 * seatbelt 顺序敏感：narrower allow 必须在 deny 之后（spec 执行提示）。
 */

import type { ResolvedFsRules } from "./rules.js";

/** Seatbelt `deny file-read*` / `allow file-read*` 片段（deny 先，allow 后）。 */
export function toSeatbeltFragments(rules: ResolvedFsRules): string {
  const lines: string[] = [];
  for (const p of rules.denyRead) {
    lines.push(`(deny file-read* (subpath "${p}"))`);
  }
  for (const p of rules.denyWrite) {
    lines.push(`(deny file-write* (subpath "${p}"))`);
  }
  // narrower allow 在 deny 之后，重开 wider deny
  for (const p of rules.allowRead) {
    lines.push(`(allow file-read* (subpath "${p}"))`);
  }
  for (const p of rules.allowWrite) {
    lines.push(`(allow file-write* (subpath "${p}"))`);
  }
  return lines.join("\n");
}

/** bwrap `--ro-bind` / `--bind` 片段（denyRead/Write → 不 bind / bind ro）。 */
export function toBubblewrapFragments(rules: ResolvedFsRules): string[] {
  const args: string[] = [];
  // allowWrite 路径可写 bind；allowRead 路径只读 bind
  for (const p of rules.allowWrite) {
    args.push("--bind", p, p);
  }
  for (const p of rules.allowRead) {
    args.push("--ro-bind", p, p);
  }
  return args;
}
