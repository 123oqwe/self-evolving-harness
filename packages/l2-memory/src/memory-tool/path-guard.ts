// L2-T02 · canonical-path 校验（static-core 委托）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T02。
// 规则（从 teamB memory-architecture:refill 采纳，与 L0C-T06 assertCanonicalPath
// 等价）：拒绝 `../`、URL 编码 `%2e%2e`、以及对 `/memories` 根自身的操作。
//
// 返回 discriminated result：成功时给出 `topic`（`/memories/` 之后的余部，
// 供物理路径映射）；失败时给出含 "escape" 字样的错误信息（测试契约）。
//
// 注意：本模块为 L2 自包含实现（不跨包导入 @harness/l0-core，避免新增依赖），
// 行为与 L0C-T06 assertCanonicalPath 一致。

/** canonical memory 根。所有 memory 路径必须严格位于其下。 */
export const MEMORY_ROOT = "/memories/";

export type CanonicalPathResult =
  | { readonly ok: true; readonly topic: string }
  | { readonly ok: false; readonly error: string };

/**
 * 校验 memory 虚拟路径并提取 topic。
 *
 * 拒绝情形（均返回 `ok:false` 且 error 含 "escape"）：
 *  - 空字符串 / 非字符串
 *  - URI 转义解码失败（malformed escape）
 *  - 不以 `/memories/` 开头（含对 `/memories` 根自身的操作）
 *  - topic 余部为空（对根操作）
 *  - 任何 `..` 或 `.` 路径段（literal 或 decode 后）
 *  - 残留 `%2e` 编码点
 */
export function canonicalMemoryPath(path: string): CanonicalPathResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, error: "path escape: path must be a non-empty string" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return {
      ok: false,
      error: `path escape: malformed URI escape in \`${path}\``,
    };
  }

  if (!decoded.startsWith(MEMORY_ROOT)) {
    return {
      ok: false,
      error: `path escape: path must be under ${MEMORY_ROOT} (got \`${path}\`)`,
    };
  }

  const topic = decoded.slice(MEMORY_ROOT.length);
  if (topic.length === 0) {
    return {
      ok: false,
      error: `path escape: cannot operate on root ${MEMORY_ROOT}`,
    };
  }

  const segments = topic.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    return {
      ok: false,
      error: `path escape: traversal segment in \`${path}\``,
    };
  }

  if (/%2e/i.test(path)) {
    return {
      ok: false,
      error: `path escape: encoded traversal \`%2e\` in \`${path}\``,
    };
  }

  return { ok: true, topic };
}
