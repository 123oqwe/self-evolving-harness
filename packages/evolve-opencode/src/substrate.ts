// PLG-T03: OpenCode 基质路径映射 helper。
//
// Spec: execution/plugin/TASKS.md §PLG-T03 (substrate.ts).
// 复用铁律（§0.2）：`SubstrateHandle`/`inferKind`/`contentSha` 复用
// @harness/adapters port.ts 纯函数；不在插件包内重造 sha/kind 推断。

import { basename } from "node:path";
import { contentSha, inferKind } from "@harness/adapters";
import type { SubstrateHandle } from "@harness/adapters";

/** OpenCode 基质 id 前缀。 */
export const OPENCODE_SUBSTRATE_PREFIX = "opencode/";

/**
 * 把基质 id（`opencode/AGENTS.md`、`opencode/plugins/x.ts`）映射为
 * `.opencode/` 目录内相对路径（`AGENTS.md`、`plugins/x.ts`）。
 * 非 `opencode/` 前缀的 id 原样返回（兼容裸相对路径）。
 */
export function mapOpenCodeSubstratePath(id: string): string {
  if (id.startsWith(OPENCODE_SUBSTRATE_PREFIX)) {
    return id.slice(OPENCODE_SUBSTRATE_PREFIX.length);
  }
  return id;
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
  return basename(mapOpenCodeSubstratePath(id));
}
