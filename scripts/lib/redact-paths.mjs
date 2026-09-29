// scripts/lib/redact-paths.mjs — ISS-12 报告路径脱敏（输出层统一脱敏）
//
// 契约（REMEDIATION ISS-12）：
//   报告写入函数统一脱敏——repo 根（绝对路径）→ `<repo>`，HOME（绝对路径）→ `~`。
//   作用于输出层（writeFileSync 之前），清洗已落盘报告由调用方按同一函数处理。
//
// 设计：
//   - repoRoot 比 HOME 更具体（repoRoot 通常位于 HOME 之下），先替换 repoRoot 再替换
//     HOME，避免 repo 路径被降级成 `~/...` 而丢失「这是 repo 内路径」的语义。
//   - 用「路径段边界」负向前查 `(?![A-Za-z0-9._-])` 防止前缀误伤：例如 repoRoot
//     `/a/repo` 不会匹配 `/a/repository` 中的子串（`i` 是路径段字符，被前查挡住）。
//   - 纯函数、零依赖（仅 node:os），便于单测。
//
// 用法：
//   import { redactPaths } from "./scripts/lib/redact-paths.mjs";
//   writeFileSync(path, redactPaths(content), "utf8");
//   // 或显式注入（测试 / 非 CWD 场景）：
//   redactPaths(content, { repoRoot: "/abs/repo", home: "/abs/home" });

import { homedir } from "node:os";

/** 转义正则元字符。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 将文本中泄露本机绝对路径的片段脱敏：
 *   repoRoot（绝对）→ `<repo>`，HOME（绝对）→ `~`。
 *
 * @param {string} text 待脱敏文本。非字符串原样返回（防御 writeFileSync 前的任意值）。
 * @param {{repoRoot?: string, home?: string}} [opts]
 *   - repoRoot：仓库根绝对路径，缺省 `process.cwd()`。
 *   - home：用户主目录绝对路径，缺省 `os.homedir()`。
 *     传入空串则跳过对应替换。
 * @returns {string}
 */
export function redactPaths(text, opts = {}) {
  if (typeof text !== "string") return text;
  const repoRoot = opts.repoRoot !== undefined ? opts.repoRoot : process.cwd();
  const home = opts.home !== undefined ? opts.home : homedir();
  let out = text;
  // 先替换更具体的 repoRoot，再替换 HOME（覆盖 repo 之外的本机路径）。
  if (repoRoot) {
    out = out.replace(
      new RegExp(escapeRe(repoRoot) + "(?![A-Za-z0-9._-])", "g"),
      "<repo>",
    );
  }
  if (home) {
    out = out.replace(
      new RegExp(escapeRe(home) + "(?![A-Za-z0-9._-])", "g"),
      "~",
    );
  }
  return out;
}

export { homedir };
