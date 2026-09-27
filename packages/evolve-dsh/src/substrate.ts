// PLG-T11: dsh 基质 id → 磁盘路径映射（纯函数，无副作用）。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
//
// 两类基质 id：
//   - 'dsh/AGENTS.md'                          → repo 级主基质（repoRoot/AGENTS.md，git 版本化）
//   - 'dsh/profiles/<n>/cordis.patch.yml'      → profile 叠加层基质（dshHome/profiles/<n>/cordis.patch.yml，
//                                                 整体文本读写，不解释 YAML patch 语义）

import { join } from "node:path";

/** 基质 id 解析结果：读路径 + repoRoot 内镜像相对路径 + 是否 profile patch。 */
export interface DshSubstrateMapping {
  /** 读 active 内容的绝对路径（AGENTS.md → repoRoot；profile patch → dshHome）。 */
  readonly readPath: string;
  /** repoRoot 内 git 版本化镜像相对路径（deploy/rollback 写回 + git commit 目标）。 */
  readonly repoRelPath: string;
  /** 是否为 profile 叠加层基质（deploy 时需同步到 dshHome/profiles/<profile>/）。 */
  readonly isProfile: boolean;
  /** 若是 profile 基质，对应的 dshHome 同步绝对路径；否则 null。 */
  readonly profileSyncPath: string | null;
}

const AGENTS_ID = "dsh/AGENTS.md";
const PROFILE_RE = /^dsh\/profiles\/([^/]+)\/cordis\.patch\.yml$/;

/**
 * 把基质 id 映射到磁盘路径。
 * 返回 null 表示 id 不属于已知 dsh 基质（调用方据此抛 SubstrateNotFoundError）。
 */
export function mapDshSubstratePath(
  id: string,
  repoRoot: string,
  dshHome: string,
): DshSubstrateMapping | null {
  if (id === AGENTS_ID) {
    return {
      readPath: join(repoRoot, "AGENTS.md"),
      repoRelPath: "AGENTS.md",
      isProfile: false,
      profileSyncPath: null,
    };
  }
  const m = PROFILE_RE.exec(id);
  if (m) {
    const profileName = m[1] as string;
    const rel = `profiles/${profileName}/cordis.patch.yml`;
    return {
      readPath: join(dshHome, rel),
      repoRelPath: rel,
      isProfile: true,
      profileSyncPath: join(dshHome, "profiles", profileName, "cordis.patch.yml"),
    };
  }
  return null;
}
