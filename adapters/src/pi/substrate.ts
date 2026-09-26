// ADP-T02: pi 基质路径映射 helper。
//
// Spec: execution/adapt/TASKS.md §ADP-T02 (substrate.ts, REFACTOR mapSubstratePath)。
// 复用铁律：`SubstrateHandle`/`inferKind`/`contentSha` 复用 ADP-T01 port.ts 纯函数。
//
// pi 基质 id 形如 `pi/prompts/compaction-summary.md`：`pi/` 前缀标识宿主，
// 去前缀后为 piHome 内相对路径（`prompts/compaction-summary.md`），同时是
// repoRoot 镜像目录的 git 版本化相对路径。

import { basename } from "node:path";
import { contentSha, inferKind } from "../port.js";
import type { SubstrateHandle } from "../port.js";

/** pi 基质 id 前缀。 */
export const PI_SUBSTRATE_PREFIX = "pi/";

/**
 * 把基质 id（`pi/prompts/x.md`）映射为 piHome/repoRoot 内相对路径
 * （`prompts/x.md`）。非 `pi/` 前缀的 id 原样返回（兼容裸相对路径）。
 */
export function mapSubstratePath(id: string): string {
  if (id.startsWith(PI_SUBSTRATE_PREFIX)) {
    return id.slice(PI_SUBSTRATE_PREFIX.length);
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
  return basename(mapSubstratePath(id));
}
