/**
 * L0S-T02 — 网络拒绝 surfacing 共享逻辑（seatbelt + bwrap 双后端）
 *
 * 逃逸门硬约束（spec）：出站拒绝必须**可见**——结果 stderr 须含拒绝语义。
 * 但静默工具（`curl -s` 的 `-s` 抑制错误消息）会把内核拒绝吞掉：沙箱确实
 * 拒了（exit≠0），stderr 却为空——逃逸门的可见性断言被静默绕过（cloud CI
 * 实证：macos seatbelt 与 linux bwrap 真实非嵌套路径均命中）。
 *
 * 修复语义：调用方要求网络隔离 && 命令失败 && stderr 无任何可见拒绝签名时，
 * 用自有探针（同一沙箱 profile/argv 内的固定 egress 尝试）复测，把**真实的
 * 探针拒绝输出**（非合成记录）追加进结果 stderr，行带 `[sandbox-net-verify]`
 * 前缀与用户命令输出区分。与 round 2 缺陷 3 的"不伪造合成拒绝记录"原则一致：
 * 只追加真实存在的工具/内核拒绝签名行；探针未产出拒绝证据（如未沙箱化的
 * `Connection refused`）时结果原样透传。
 */

import type { NetRules } from "./types.js";

/**
 * 命令 stderr 中已可见的网络拒绝签名（宽松门控用）：含 Connection refused /
 * Could not connect / Failed to connect——只要拒绝语义已可见就无需探针。
 */
const NET_DENY_VISIBLE_RE =
  /Could not resolve|Could not connect|Failed to connect|Connection refused|Network is unreachable|Operation not permitted|EPERM|Permission denied/i;

/**
 * 探针输出中可采纳的拒绝证据（严格）：只认无法在未沙箱化环境下出现的
 * 内核/解析器拒绝签名。`Connection refused` / `Could not connect` /
 * `Failed to connect` 在未沙箱化的 loopback connect（端口关闭）同样出现，
 * 不能作为沙箱拒绝证据（防伪造）。
 */
const NET_DENY_EVIDENCE_RE =
  /Could not resolve|Network is unreachable|Operation not permitted|EPERM|Permission denied/i;

/** 命令 stderr 是否已含可见网络拒绝语义（门控探针用）。 */
export function hasVisibleNetDeny(stderr: string): boolean {
  return NET_DENY_VISIBLE_RE.test(stderr);
}

/**
 * 网络隔离需求判定：只有调用方显式要求网络约束（allowedDomains /
 * denyOutCidr 任一非空）时才做 egress 探针 surfacing（空 netRules = 无
 * 网络约束语义，裁决 A1 / ERRATA L0S-R3；与嵌套路径 netDenied 同源判定，
 * round 2 缺陷 2）。
 */
export function netIsolationDemanded(netRules: NetRules): boolean {
  return (
    netRules.allowedDomains.length > 0 || netRules.denyOutCidr.length > 0
  );
}

/**
 * 从探针 stderr 提取可采纳的网络拒绝签名行。只采纳严格签名命中的行——
 * 真实工具输出，非合成。
 */
export function extractNetDenyHits(probeStderr: string): string[] {
  return probeStderr
    .split("\n")
    .filter((line) => NET_DENY_EVIDENCE_RE.test(line));
}

/**
 * 把探针拒绝证据合并进用户命令结果：探针行带 `[sandbox-net-verify]` 前缀
 * 追加到 stderr 尾部，同步进 epermHits。探针无可采纳证据时结果不变
 * （无关失败原样透传，不伪造）。
 */
export function mergeNetVerifyEvidence(
  userStderr: string,
  userEpermHits: readonly string[],
  probeStderr: string,
): { stderr: string; epermHits: string[] } {
  const hits = extractNetDenyHits(probeStderr);
  if (hits.length === 0) {
    return { stderr: userStderr, epermHits: [...userEpermHits] };
  }
  const marked = hits.map((line) => `[sandbox-net-verify] ${line}`);
  const base =
    userStderr === "" || userStderr.endsWith("\n")
      ? userStderr
      : userStderr + "\n";
  return {
    stderr: base + marked.join("\n") + "\n",
    epermHits: [...userEpermHits, ...marked],
  };
}
