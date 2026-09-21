/**
 * L0S-T11 — C5 injectHosts / 脱敏规则 / 敏感 env 名进化（canary 泄漏率=0 零容忍）
 *
 * C5 策略进化。injectHosts 表 / 脱敏规则 / 敏感 env 名模式 进化
 *（02-sandbox-security C5）。强约束：
 *   - injectHosts ⊆ allowedDomains（防 agent 自开凭据注入后门）；
 *   - 新增 injectHost 须人工签发（复用 T08 ChangeSignoff）；
 *   - canary 泄漏率=0 零容忍（canary-gate.ts）。
 *
 * 文件/模块布局：
 *   - `credential-policy/index.ts` — `CredentialPolicyRegistry`（本文件）
 *   - `credential-policy/canary-gate.ts` — canary 零容忍门
 *
 * ERRATA L0S-T11：
 *   - `CredentialPolicy` 含 `allowedDomains?: string[]` 字段（spec 缺）；
 *     ⊆ allowedDomains 校验的权威来源为 registry 构造器注入的 allowedDomains。
 *   - 构造器注入 `{ allowedDomains, trustedSigners, verifySignoff }`。
 *   - `assertChangeAllowed` 校验 injectHosts 新增须签发 + ⊆ allowedDomains；
 *     签发验证机制同 T08（复用 ChangeSignoff，结构化 expectedChange=`"add <host>"`）。
 */

import {
  ChangeSignoff,
  type Signoff,
  type VerifySignoffFn,
} from "../net-policies/signoff.js";
import { assertCanaryZero, type CanaryResult } from "./canary-gate.js";

/** 脱敏规则：须脱敏的 header 名 + body 字段名。 */
export interface RedactRules {
  header: string[];
  bodyField: string[];
}

/** 凭据策略版本快照。 */
export interface CredentialPolicy {
  version: string;
  /** 允许注入真实凭据的 host 集（须 ⊆ allowedDomains）。 */
  injectHosts: string[];
  /** 脱敏规则（header / bodyField）。 */
  redactRules: RedactRules;
  /** 敏感 env 名模式（正则源串）。 */
  sensitiveEnvPatterns: string[];
  /** 本版本变更的人工签发记录。 */
  signoffs: Signoff[];
  /**
   * 允许域 allowlist（spec 缺，ERRATA 补）。
   * ⊆ allowedDomains 校验的权威来源为 registry 构造器注入的 allowedDomains；
   * 此字段允许 policy 自带声明，registry 以构造器注入值为最终裁定。
   */
  allowedDomains?: string[];
}

/** 策略 diff 结果。 */
export interface CredentialPolicyDiff {
  /** 新增的 injectHost（须签发 + ⊆ allowedDomains）。 */
  injectHostsAdded: string[];
  /** 收紧的脱敏规则（新增 header / bodyField，自动放行）。 */
  redactRulesTightened: string[];
  /** 新增的敏感 env pattern（自动放行）。 */
  sensitiveEnvAdded: string[];
}

/** CredentialPolicyRegistry 构造选项。 */
export interface CredentialPolicyRegistryOpts {
  /** 允许域 allowlist（injectHosts 须 ⊆ 此集）。 */
  allowedDomains: string[];
  /** 可信签发人 allowlist。 */
  trustedSigners: string[];
  /** 可注入的签发验证函数（缺省 fail-closed，同 T08）。 */
  verifySignoff?: VerifySignoffFn;
}

/**
 * 凭据策略注册表：diff + 签发 gate + ⊆ allowedDomains 校验 + canary 零容忍门。
 *
 * - `diff`：计算 prev → next 的策略 diff。
 * - `assertChangeAllowed`：injectHosts 新增须签发 + ⊆ allowedDomains；
 *   脱敏收紧 / 敏感 env 新增自动放行。
 * - `assertCanaryZero`：canary 泄漏零容忍门（委托 canary-gate）。
 */
export class CredentialPolicyRegistry {
  private readonly allowedDomains: Set<string>;
  private readonly signoff: ChangeSignoff;

  constructor(opts: CredentialPolicyRegistryOpts) {
    this.allowedDomains = new Set(opts.allowedDomains);
    this.signoff = new ChangeSignoff({
      trustedSigners: opts.trustedSigners,
      ...(opts.verifySignoff ? { verifySignoff: opts.verifySignoff } : {}),
    });
  }

  /** 计算 prev → next 的策略 diff。 */
  diff(prev: CredentialPolicy, next: CredentialPolicy): CredentialPolicyDiff {
    const injectHostsAdded = [...next.injectHosts].filter(
      (h) => !prev.injectHosts.includes(h),
    );

    const prevHeaders = new Set(prev.redactRules.header);
    const prevBody = new Set(prev.redactRules.bodyField);
    const redactRulesTightened: string[] = [];
    for (const h of next.redactRules.header) {
      if (!prevHeaders.has(h)) redactRulesTightened.push(`header:${h}`);
    }
    for (const f of next.redactRules.bodyField) {
      if (!prevBody.has(f)) redactRulesTightened.push(`bodyField:${f}`);
    }

    const sensitiveEnvAdded = [...next.sensitiveEnvPatterns].filter(
      (p) => !prev.sensitiveEnvPatterns.includes(p),
    );

    return { injectHostsAdded, redactRulesTightened, sensitiveEnvAdded };
  }

  /**
   * 断言策略变更被允许：
   *   - injectHosts 新增须 ⊆ allowedDomains 且有人工签发（expectedChange=`"add <host>"`）；
   *   - 脱敏收紧 / 敏感 env 新增自动放行（无须签发）。
   *
   * @throws injectHost 不在 allowedDomains / 无签发 / 签发验证失败
   */
  assertChangeAllowed(diff: CredentialPolicyDiff, next: CredentialPolicy): void {
    for (const host of diff.injectHostsAdded) {
      // 1) ⊆ allowedDomains 校验（防 agent 自开凭据注入后门）。
      if (!this.allowedDomains.has(host)) {
        throw new Error(
          `injectHost "${host}" ⊈ allowedDomains (C5 invariant): ` +
            `host not in allowedDomains, credential injection refused`,
        );
      }
      // 2) 人工签发校验（复用 T08 ChangeSignoff，结构化精确匹配）。
      this.signoff.assertSigned(next.signoffs, `add ${host}`);
    }
    // redactRulesTightened / sensitiveEnvAdded：脱敏收紧自动放行，无须签发。
  }

  /**
   * canary 零容忍门：policy 变更后 canary 必须零泄漏。
   * 委托 canary-gate.assertCanaryZero。
   */
  assertCanaryZero(policy: CredentialPolicy, canaryResult: CanaryResult): void {
    assertCanaryZero(policy, canaryResult);
  }
}

export { assertCanaryZero, type CanaryResult } from "./canary-gate.js";
