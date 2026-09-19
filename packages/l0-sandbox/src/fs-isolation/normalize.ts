/**
 * L0S-T03 — 路径规范化（resolve `~` / symlink），防 bypass。
 *
 * spec 执行提示：`~` 在 sandbox 内不展开，必须 brain 端 resolve；
 * 用 `fs.realpath` 解析 symlink 后必须再 normalize，否则攻击者用
 * symlink 前缀绕过 prefix match。
 *
 * 裁决 L0S-T03-A3：`isDenied` 内部自动调用 `fs.realpath` 解析传入 path
 * 的 symlink 后再 prefix match，调用方无需先 normalize。
 */

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * 展开 `~` 为 `os.homedir()`，并把路径规范化为绝对路径（去尾斜杠，
 * root `/` 保留）。规则前缀与待判路径共用此规范化。
 */
export function normalizePath(p: string): string {
  let expanded = p;
  if (p === "~") {
    expanded = homedir();
  } else if (p.startsWith("~/")) {
    expanded = join(homedir(), p.slice(2));
  }
  return resolve(expanded);
}

/**
 * 解析 path 的 symlink 后返回其规范化绝对路径。
 *
 * 若 path 整体存在，直接 `fs.realpathSync`；若 path 尾部组件不存在，
 * 逐级上溯到最长存在祖先，realpath 该祖先后拼回不存在尾段——
 * 保证攻击者用「symlink 指向被禁路径」绕过 prefix match 时仍被拦截。
 */
export function resolveSymlink(target: string): string {
  const norm = normalizePath(target);
  try {
    return realpathSync(norm);
  } catch {
    // 整体不存在，回退到逐级上溯
  }

  let existing = norm;
  const tail: string[] = [];
  // 上限：到 root 为止（dirname("/") === "/"）
  for (let i = 0; i < 1024; i++) {
    try {
      const real = realpathSync(existing);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        // 到 root 仍不可 realpath，直接返回规范化结果
        return norm;
      }
      tail.unshift(basename(existing));
      existing = parent;
    }
  }
  return norm;
}
