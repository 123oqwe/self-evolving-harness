// PLG-T11: profile patch 同步 helper（不含 patch 语义解析）。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
// cordis.patch.yml 是 dsh Cordis 私有 YAML patch 格式——本包只做整体文本
// 基质读写（变异在文本层），不解析/校验 patch 语义。

import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * 把 repoRoot 镜像内的 profile patch 同步到 dshHome/profiles/<profile>/（deploy 正向）。
 * 若源文件不存在则静默跳过（防御性，不崩）。
 */
export function syncProfileToDshHome(
  repoMirrorPath: string,
  dshHomeSyncPath: string,
): void {
  if (!existsSync(repoMirrorPath)) return;
  mkdirSync(dirname(dshHomeSyncPath), { recursive: true });
  copyFileSync(repoMirrorPath, dshHomeSyncPath);
}

/**
 * 反向同步：从 repoRoot 镜像还原 dshHome profile patch（rollback 时）。
 * 等价于正向同步（rollback 先 git checkout 镜像到旧版本，再同步到 dshHome）。
 */
export function reverseSyncProfile(
  repoMirrorPath: string,
  dshHomeSyncPath: string,
): void {
  syncProfileToDshHome(repoMirrorPath, dshHomeSyncPath);
}

/** 读 profile patch 整体文本（不解析 YAML 语义）。 */
export function readProfilePatch(absPath: string): string {
  return readFileSync(absPath, "utf8");
}

/** 写 profile patch 整体文本到指定路径（创建父目录）。 */
export function writeProfilePatch(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}
