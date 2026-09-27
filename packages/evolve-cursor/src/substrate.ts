// PLG-T06: Cursor 基质路径映射 helper。
//
// Spec: execution/plugin/TASKS.md §PLG-T06 (substrate.ts)。
// 复用铁律（§0.2）：`SubstrateHandle`/`inferKind`/`contentSha` 复用 ADP-T01
// port.ts 纯函数（不重造）。
//
// Cursor 基质 id 形如 `cursor/rules/evolve.mdc`：`cursor/` 前缀标识宿主，去前缀
// 后映射到 repoRoot（git 版本化目录）内的 `.cursor/rules/<name>.mdc`（Cursor
// Project Rules 约定：规则文件放入 `.cursor/rules` 即被自动发现并注册）。

import { basename, extname } from "node:path";
import { contentSha, inferKind } from "@harness/adapters";
import type { SubstrateHandle } from "@harness/adapters";
import type { SubstrateKind } from "@harness/l3-engine";

/** Cursor 基质 id 前缀。 */
export const CURSOR_SUBSTRATE_PREFIX = "cursor/";

/**
 * 把基质 id 映射为 repoRoot 内相对路径。
 *
 *  - `cursor/rules/evolve.mdc` → `.cursor/rules/evolve.mdc`
 *  - `cursor/<rest>`           → `.cursor/<rest>`（保守：其余 cursor 配置落 .cursor/）
 *  - 非 `cursor/` 前缀的 id 原样返回（兼容裸相对路径）
 */
export function mapCursorSubstratePath(id: string): string {
  if (!id.startsWith(CURSOR_SUBSTRATE_PREFIX)) {
    return id;
  }
  const rel = id.slice(CURSOR_SUBSTRATE_PREFIX.length);
  return `.cursor/${rel}`;
}

/** 构造 immutable SubstrateHandle（复用 contentSha + inferKind）。 */
export function makeCursorSubstrateHandle(
  id: string,
  content: string,
): SubstrateHandle {
  return Object.freeze({
    id,
    kind: cursorKind(id),
    content,
    sha: contentSha(content),
  }) as SubstrateHandle;
}

/**
 * 推断 Cursor 基质 SubstrateKind。
 *
 * `.mdc` / `.md` 是 markdown 规则文件（prompt-like），映射到 `prompt`——
 * L3 breaker 对 `weight` channel 默认关闭（PRD §6.1 N1），若交给 inferKind
 * 处理 `.mdc` 会落到默认 `weight` 触发 breaker。其余 id 透传 inferKind。
 */
function cursorKind(id: string): SubstrateKind {
  const ext = extname(id).toLowerCase();
  if (ext === ".mdc" || ext === ".md") return "prompt";
  return inferKind(id);
}

/** 取基质 basename（deploy 版本后缀用）。 */
export function cursorSubstrateBasename(id: string): string {
  return basename(mapCursorSubstratePath(id));
}

/** parseMdc 结果：frontmatter 原文 + body + 简单字段映射。 */
export interface ParsedMdc {
  /** frontmatter 块原文（含首尾 `---` 行之间的内容，不含分隔符），无则空串。 */
  readonly frontmatter: string;
  /** markdown body（frontmatter 之后的内容）。 */
  readonly body: string;
  /** 简单 `key: value` 字段映射（值去空白；不嵌套解析，仅供读取 description/alwaysApply）。 */
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * 解析 .mdc frontmatter + body（REFACTOR：抽离通用解析，不依赖 Cursor 私有）。
 *
 *  - 文件以 `---\n` 起始且第二个 `---` 行存在 → 切分 frontmatter / body
 *  - 否则整文为 body，frontmatter 为空
 *  - fields 用行级 `key: value` 切分（值去首尾空白），不处理嵌套/引号——
 *    Cursor mdc frontmatter 字段（description/alwaysApply/globs）均为扁平标量
 */
export function parseMdc(content: string): ParsedMdc {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: "", body: content, fields: {} };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: "", body: content, fields: {} };
  }
  const fmLines = lines.slice(1, end);
  const frontmatter = fmLines.join("\n");
  const body = lines.slice(end + 1).join("\n");
  const fields: Record<string, string> = {};
  for (const line of fmLines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) fields[key] = val;
  }
  return { frontmatter, body, fields };
}
