// ADP-T03: Claude Code 基质路径映射 helper。
//
// Spec: execution/adapt/TASKS.md §ADP-T03 (substrate.ts).
// 复用铁律（§0.2）：`SubstrateHandle`/`inferKind`/`contentSha` 复用 ADP-T01
// port.ts 纯函数（不重造）。
//
// Claude Code 基质 id 形如 `claude-code/CLAUDE.md` 或
// `claude-code/skills/evolve/SKILL.md`：`claude-code/` 前缀标识宿主，去前缀后为
// repoRoot（git 版本化目录）内相对路径。CLAUDE.md / SKILL.md / hooks policy
// 均为 repoRoot 内 git 版本化文件。

import { basename } from "node:path";
import { contentSha, inferKind } from "../port.js";
import type { SubstrateHandle } from "../port.js";

/** Claude Code 基质 id 前缀。 */
export const CLAUDE_CODE_SUBSTRATE_PREFIX = "claude-code/";

/**
 * 把基质 id 映射为 repoRoot 内相对路径。
 *
 *  - `claude-code/CLAUDE.md`        → `CLAUDE.md`（repo 根，Claude Code 约定）
 *  - `claude-code/skills/...`       → `.claude/skills/...`（.claude 命名空间）
 *  - `claude-code/hooks/...`        → `.claude/hooks/...`
 *  - `claude-code/settings.json`    → `.claude/settings.json`
 *  - 非 `claude-code/` 前缀的 id 原样返回（兼容裸相对路径）
 *
 * CLAUDE.md 是 Claude Code 的 repo 根约定（agent 读 repo 根 CLAUDE.md），
 * 其余 agent 配置落 `.claude/` 命名空间。
 */
export function mapSubstratePath(id: string): string {
  let rel: string;
  if (id.startsWith(CLAUDE_CODE_SUBSTRATE_PREFIX)) {
    rel = id.slice(CLAUDE_CODE_SUBSTRATE_PREFIX.length);
  } else {
    return id;
  }
  // CLAUDE.md 留在 repo 根；skills/hooks/settings 落 .claude/ 命名空间。
  if (
    rel === "CLAUDE.md" ||
    rel.startsWith("skills/") ||
    rel.startsWith("hooks/") ||
    rel === "settings.json"
  ) {
    if (rel === "CLAUDE.md") return rel;
    return `.claude/${rel}`;
  }
  return rel;
}

/** 构造 immutable SubstrateHandle（复用 contentSha + inferKind）。 */
export function makeSubstrateHandle(
  id: string,
  content: string,
): SubstrateHandle {
  return Object.freeze({
    id,
    kind: inferKind(id),
    content,
    sha: contentSha(content),
  }) as SubstrateHandle;
}

/** 取基质 basename（deploy 版本后缀用）。 */
export function substrateBasename(id: string): string {
  return basename(mapSubstratePath(id));
}
