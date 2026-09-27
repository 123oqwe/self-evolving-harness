// PLG-T02: Codex 基质路径映射 helper。
//
// Spec: execution/plugin/TASKS.md §PLG-T02 (substrate.ts)。
// 复用铁律（§0.2）：`SubstrateHandle`/`contentSha`/`inferKind` 复用
// @harness/adapters port.ts 纯函数，不重造。
//
// Codex 基质 id 形如 `codex/AGENTS.md`：`codex/` 前缀标识宿主，去前缀后为
// repoRoot git 版本化镜像目录内的相对路径（`AGENTS.md`）。`codex/prompts/*`
// → `prompts/*`。

import { basename } from "node:path";
import { contentSha, inferKind } from "@harness/adapters";
import type { SubstrateHandle } from "@harness/adapters";

/** Codex 基质 id 前缀。 */
export const CODEX_SUBSTRATE_PREFIX = "codex/";

/**
 * 把基质 id（`codex/AGENTS.md`）映射为 repoRoot 内相对路径（`AGENTS.md`）。
 * 非 `codex/` 前缀的 id 原样返回（兼容裸相对路径）。
 */
export function mapCodexSubstratePath(id: string): string {
  if (id.startsWith(CODEX_SUBSTRATE_PREFIX)) {
    return id.slice(CODEX_SUBSTRATE_PREFIX.length);
  }
  return id;
}

/** 构造 immutable SubstrateHandle（复用 contentSha + inferKind）。 */
export function makeCodexSubstrateHandle(
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

/** 取基质 basename（deploy 版本后缀用，复用 L3-T08 bumpVersion）。 */
export function codexSubstrateBasename(id: string): string {
  return basename(mapCodexSubstratePath(id));
}
