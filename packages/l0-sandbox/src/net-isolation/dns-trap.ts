/**
 * L0S-T04a — CIDR / IP 匹配 + DNS rebinding 门（resolveAndCheck）
 *
 * 对 dns.lookup 解析出的 IP 再过 NetRules.denyOutCidr，防止域名虽在 allowlist
 * 但解析到 cloud metadata（169.254.169.254）等危险地址的 exfil。
 *
 * 仅实现 IPv4 CIDR 匹配（MVP 阶段 denyOut 模式为 `0.0.0.0/0` / 单 IP /32）。
 *
 * ERRATA-w2plus L0S-T04a：导出纯函数 `resolveAndCheck`，把「allowlist 判定 →
 * DNS 解析 → CIDR 判定 → fail-closed」整条门集中到一个可注入 resolver 的
 * 纯函数中，使 DNS rebinding 门可被直测（注入 resolver 返回 169.254.169.254
 * 即可断言 allowed=false），而不依赖 vi.doMock 对包内动态 import 的覆盖。
 */

import type { LookupAddress } from "node:dns";
import type { NetRules } from "../os-sandbox/types.js";
import { isAllowed } from "./allowlist.js";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const oct = Number.parseInt(p, 10);
    if (!Number.isInteger(oct) || oct < 0 || oct > 255) return null;
    n = (n << 8) | oct;
  }
  // 注意：JS 位运算返回有符号 32 位；用 >>>0 归一为无符号。
  return n >>> 0;
}

function parseCidr(cidr: string): { base: number; mask: number } | null {
  const slashIdx = cidr.indexOf("/");
  const ip = slashIdx >= 0 ? cidr.slice(0, slashIdx) : cidr;
  const prefixStr = slashIdx >= 0 ? cidr.slice(slashIdx + 1) : undefined;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return null;
  const prefix = prefixStr === undefined ? 32 : Number.parseInt(prefixStr, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  // base 须与 ipDenied 中的 `(ipInt & mask) >>> 0` 同为无符号 32 位归一，
  // 否则对 >2^31 的 IP（如 169.254.169.254=2852039166）会因有符号/无符号
  // 不匹配而漏判（fail-open on cloud metadata）。
  return { base: (ipInt & mask) >>> 0, mask };
}

/** 判定 IP 是否命中任一 denyOut CIDR。 */
export function ipDenied(ip: string, denyOutCidr: string[]): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false; // 非 IPv4（IPv6 等），MVP 不判定 → 不命中
  for (const cidr of denyOutCidr) {
    const parsed = parseCidr(cidr);
    if (!parsed) continue;
    if (((ipInt & parsed.mask) >>> 0) === parsed.base) return true;
  }
  return false;
}

/** 可注入的 DNS 解析器：接收 host，返回 IP 地址数组（支持多 A 记录）。 */
export type DnsResolver = (host: string) => Promise<string[]>;

/** resolveAndCheck 的判定结果。 */
export interface ResolveResult {
  allowed: boolean;
  ip: string;
  reason?: string;
}

/**
 * 默认 DNS 解析器：用 node:dns.promises.lookup 取单条 A 记录。
 *
 * 动态 import node:dns（避免顶层加载；调用方/测试可通过注入 resolver 完全
 * 绕过此路径以实现确定性直测）。
 */
const defaultResolver: DnsResolver = async (host) => {
  const dns = await import("node:dns");
  const addr: string | LookupAddress = await dns.promises.lookup(host);
  const ip = typeof addr === "string" ? addr : addr.address;
  return [ip];
};

/**
 * DNS rebinding 门（纯函数，可注入 resolver）。
 *
 * 判定顺序（fail-closed）：
 *   1. `isAllowed(host, rules)`：不在 allowlist → `{allowed:false, ip:"", reason}`。
 *   2. `denyOutCidr.length === 0`：无 CIDR 门 → `{allowed:true, ip:""}`（无需解析 DNS）。
 *   3. 用 `resolver ?? defaultResolver` 取 IP 数组；resolver 抛错 →
 *      `{allowed:false, ip:"", reason:"dns_lookup_failed"}`（fail-closed）。
 *   4. 逐个 IP 过 `ipDenied`：命中任一 denyOut CIDR →
 *      `{allowed:false, ip, reason:"ip matches denyOutCidr"}`。
 *   5. 全部不命中 → `{allowed:true, ip: <首个IP>}`。
 */
export async function resolveAndCheck(
  host: string,
  rules: NetRules,
  resolver?: DnsResolver,
): Promise<ResolveResult> {
  const decision = isAllowed(host, rules);
  if (!decision.allowed) {
    const reason = decision.reason ?? "not_allowed";
    return { allowed: false, ip: "", reason };
  }
  if (rules.denyOutCidr.length === 0) {
    return { allowed: true, ip: "" };
  }

  const resolve = resolver ?? defaultResolver;
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    return { allowed: false, ip: "", reason: "dns_lookup_failed" };
  }

  for (const ip of ips) {
    if (ipDenied(ip, rules.denyOutCidr)) {
      return { allowed: false, ip, reason: "ip matches denyOutCidr" };
    }
  }
  return { allowed: true, ip: ips[0] ?? "" };
}
