// CE-T01a REFACTOR: sha256 计算抽到独立模块（manifest-hash.ts）。
//
// 供 canary 发布管线（CE-T06 release）与 scripts/verify.sh CE-T01a 行为断言
// （manifest tasks>=30 + sha256 一致）复用。loadCanary 不在此处强制校验
// sha256（manifest 可在冻结前由发布管线写入；锁定测试用占位 sha256 验证
// 反序列化路径），仅暴露纯计算函数。
//
// 自洽 sha256：sha256 字段是 manifest 的一部分，若把整文件文本哈希则陷入
// 密码学不动点（哈希值写入文件后内容改变 → 哈希改变，永不可自洽）。故采用
// 业界惯例 canonicalization：计算时把 `sha256:` 行的值置空（保留键名与行结构），
// 对规范化后文本求 sha256。发布时先写入规范化哈希再落盘 → verify 自洽。
// computeManifestSha256 与 verifyManifestSha256 共用同一 canonicalize 步骤，
// 保证"写入自洽 sha256"可行且 verify===true。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * 规范化 manifest 文本：把 `sha256:` 行的值置空（保留键名），其余字节不变。
 * 使 sha256 计算脱离自身值，避免密码学不动点。
 */
function canonicalizeManifestText(text: string): string {
  return text.replace(/^sha256:\s*\S*/m, "sha256:");
}

/**
 * 计算给定 manifest 文件的 sha256（hex）。
 *
 * 计算基于规范化后的文件文本（`sha256:` 行值置空），与 `canary/manifest.yaml`
 * 中声明的 `sha256` 字段比对以验证冻结完整性。规范化使"写入自洽 sha256"可行。
 */
export function computeManifestSha256(manifestPath: string): string {
  const content = readFileSync(manifestPath, "utf8");
  const canonical = canonicalizeManifestText(content);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * 校验 manifest 文件声明的 sha256 与其规范化内容计算值一致。
 * 一致返回 true；否则 false。供发布管线（release.ts）与 verify 行为断言使用。
 */
export function verifyManifestSha256(manifestPath: string): boolean {
  let declared: string | undefined;
  try {
    const text = readFileSync(manifestPath, "utf8");
    const match = text.match(/^sha256:\s*(\S+)/m);
    if (match && match[1]) {
      declared = match[1];
    }
  } catch {
    return false;
  }
  if (!declared) return false;
  return computeManifestSha256(manifestPath) === declared;
}
