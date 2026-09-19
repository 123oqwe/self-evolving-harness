/**
 * L0S-T04a — 网络出口隔离（barrel）
 *
 * allowlist 域名匹配 + DNS rebinding 防御（CIDR）+ socat/Node-net egress proxy。
 * NetRules 类型由 os-sandbox（T02）定义，本模块消费并实现判定与 proxy。
 */

export { isAllowed, type AllowDecision } from "./allowlist.js";
export {
  ipDenied,
  resolveAndCheck,
  type DnsResolver,
  type ResolveResult,
} from "./dns-trap.js";
export { SocatProxy } from "./socat-proxy.js";
export type { SocatProxyOpts, SocatProxyHandle } from "./socat-proxy.js";
