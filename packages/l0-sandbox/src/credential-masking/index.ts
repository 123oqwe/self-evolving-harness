/**
 * L0S-T04b — 凭据掩码 proxy（barrel）
 *
 * per-session sentinel 占位符 + injectHosts ⊆ allowedDomains 校验 + proxy egress
 * 凭据注入 / SigV4 重签 + 日志脱敏。sandbox 进程及其日志永不持有真实 secret
 *（02-sandbox-security C5）。proxy 内核 + SigV4 重签 static-core；injectHosts /
 * 脱敏规则 V2 进化（L0S-T11）。
 */

export { MaskingProxy } from "./masking-proxy.js";
export type { EgressRequest, MaskingProxyOpts } from "./masking-proxy.js";
export { sigV4Sign } from "./sigv4.js";
export type { SigV4SignOpts, SigV4SignResult } from "./sigv4.js";
export {
  stripSecretEnv,
  SENSITIVE_ENV_NAME_RE,
} from "./env-strip.js";
export { createSessionVault, type SessionVault } from "./sentinel.js";
export {
  redactEgressRequest,
  REDACTED_HEADERS,
  SENSITIVE_BODY_KEYS,
} from "./log-redact.js";
