// PLG-T05: OpenClaw 基质路径映射 helper。
//
// Spec: execution/plugin/TASKS.md §PLG-T05 (substrate.ts).
// 复用铁律（§0.2）：`SubstrateHandle`/`contentSha`/`inferKind` 复用 @harness/adapters
// port.ts 纯函数（不重造）。
//
// OpenClaw 基质 id 形如 `openclaw/skills/<name>/SKILL.md` 或
// `openclaw/AGENTS.md` / `openclaw/SOUL.md` 等：`openclaw/` 前缀标识宿主，去前缀后
// 为 workspaceDir（活跃基质目录）内相对路径——同时即 repoRoot（git 版本化镜像）
// 内相对路径（镜像同构）。

import { basename } from "node:path";
import { contentSha, inferKind } from "@harness/adapters";
import type { SubstrateHandle } from "@harness/adapters";

/** OpenClaw 基质 id 前缀。 */
export const OPENCLAW_SUBSTRATE_PREFIX = "openclaw/";

/**
 * 把基质 id 映射为 workspaceDir / repoRoot 内相对路径。
 *
 *  - `openclaw/skills/evolve/SKILL.md` → `skills/evolve/SKILL.md`
 *  - `openclaw/AGENTS.md`              → `AGENTS.md`
 *  - `openclaw/SOUL.md`                → `SOUL.md`
 *  - 非 `openclaw/` 前缀的 id 原样返回（兼容裸相对路径）
 *
 * workspaceDir（活跃基质）与 repoRoot（git 镜像）目录同构，故同一 rel 可同时
 * 用于 readSubstrate（读 workspaceDir）与 writeSubstrate/deploy（写 repoRoot）。
 */
export function mapOpenClawSubstratePath(id: string): string {
  if (id.startsWith(OPENCLAW_SUBSTRATE_PREFIX)) {
    return id.slice(OPENCLAW_SUBSTRATE_PREFIX.length);
  }
  return id;
}

/** 构造 immutable SubstrateHandle（复用 contentSha + inferKind）。 */
export function makeOpenClawSubstrateHandle(
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
export function openclawSubstrateBasename(id: string): string {
  return basename(mapOpenClawSubstratePath(id));
}
