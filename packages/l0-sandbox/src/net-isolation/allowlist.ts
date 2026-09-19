/**
 * L0S-T04a — 域名 allowlist 匹配
 *
 * 匹配语义：
 * - 规则以「点号前缀」（`.npmjs.org`）表示子域通配：`registry.npmjs.org`、
 *   `a.b.npmjs.org` 均命中，但 bare apex `npmjs.org` 不被精确命中。
 * - 规则不含前导点号（`api.github.com`）表示精确匹配：仅 `api.github.com`
 *   自身命中；其子域 `x.api.github.com` 与父域拼接 `evilapi.github.com` 均不命中。
 *
 * 主机名归一化为小写后再匹配。
 */

import type { NetRules } from "../os-sandbox/types.js";

export interface AllowDecision {
  allowed: boolean;
  reason?: string;
}

/** 判断单条规则是否命中给定归一化主机名。 */
function ruleMatches(rule: string, host: string): boolean {
  if (rule.startsWith(".")) {
    // 子域通配：rule = ".npmjs.org" 命中 "registry.npmjs.org" / "a.b.npmjs.org"，
    // 不命中 "npmjs.org" 自身。
    const suffix = rule; // 含前导点号
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  // 精确匹配。
  return host === rule;
}

/**
 * 判定 host 是否在 allowlist 内。
 *
 * 返回 `{allowed, reason}`：被拒时附 reason 字符串（便于审计日志）。
 */
export function isAllowed(host: string, rules: NetRules): AllowDecision {
  const normalized = host.toLowerCase();

  for (const rule of rules.allowedDomains) {
    if (ruleMatches(rule.toLowerCase(), normalized)) {
      return { allowed: true, reason: `matched rule: ${rule}` };
    }
  }

  return {
    allowed: false,
    reason: `host ${host} not in allowedDomains`,
  };
}
