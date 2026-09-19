/**
 * L0S-T04b — MaskingProxy 主类
 *
 * C5 凭据掩码内核。sandbox 进程 env 经 buildSandboxEnv strip 为 sentinel；出站命中
 * injectHosts 时 proxy 用真实凭据重签请求（AWS host 走 SigV4 重签），否则透传
 * sentinel 并对任何混入的真实 secret 脱敏。真实 secret 永不进 hands 域、永不出现
 * 在非 injectHosts 出站。
 *
 * 不变量：injectHosts ⊆ allowedDomains（防 agent 自开凭据注入后门）。
 *
 * ERRATA-w2plus L0S-T04b：EgressRequest 类型 = { host, method, url, headers, body? }。
 */

import { randomUUID } from "node:crypto";
import { createSessionVault, type SessionVault } from "./sentinel.js";
import { stripSecretEnv } from "./env-strip.js";
import { sigV4Sign } from "./sigv4.js";
import { redactEgressRequest } from "./log-redact.js";

export interface MaskingProxyOpts {
  injectHosts: string[];
  allowedDomains: string[];
  /** key 名 → 真实值 映射（brain 域持有，永不进 hands）。 */
  secrets: Map<string, string>;
  /** 可选 sessionId（缺省随机生成）。 */
  sessionId?: string;
  /** 可选 SigV4 region/service 推断钩子（缺省按 host 推断）。 */
  resolveAwsService?: (host: string) => { region: string; service: string } | undefined;
}

export interface EgressRequest {
  host: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

const AWS_HOST_RE = /(^|\.)(amazonaws\.com|amazonaws\.com\.cn)$/i;

function defaultAwsService(host: string): { region: string; service: string } | undefined {
  if (!AWS_HOST_RE.test(host)) return undefined;
  // 形如 s3.amazonaws.com / s3.us-east-1.amazonaws.com / sqs.us-west-2.amazonaws.com
  const parts = host.split(".");
  if (parts.length >= 3 && parts[parts.length - 2] === "amazonaws") {
    const service = parts[0] ?? "s3";
    // s3.amazonaws.com → region us-east-1；s3.us-east-1.amazonaws.com → region us-east-1。
    let region = "us-east-1";
    if (parts.length >= 4 && parts[1] !== undefined && /^[a-z]+-[a-z]+-\d+$/.test(parts[1])) {
      region = parts[1];
    }
    return { region, service };
  }
  if (parts.length >= 4 && parts[parts.length - 3] === "amazonaws") {
    // .cn 变体。
    const service = parts[0] ?? "s3";
    let region = "us-east-1";
    if (parts[1] !== undefined && /^[a-z]+-[a-z]+-\d+$/.test(parts[1])) {
      region = parts[1];
    }
    return { region, service };
  }
  return { region: "us-east-1", service: "s3" };
}

export class MaskingProxy {
  private readonly injectHosts: Set<string>;
  private readonly allowedDomains: Set<string>;
  private readonly secrets: Map<string, string>;
  private readonly vault: SessionVault;
  private readonly resolveAws: (host: string) => { region: string; service: string } | undefined;

  constructor(opts: MaskingProxyOpts) {
    this.injectHosts = new Set(opts.injectHosts);
    this.allowedDomains = new Set(opts.allowedDomains);
    this.secrets = new Map(opts.secrets);
    this.vault = createSessionVault(opts.sessionId ?? randomUUID());
    this.resolveAws = opts.resolveAwsService ?? defaultAwsService;
  }

  /** injectHosts 必须 ⊆ allowedDomains，否则 throw（防 agent 自开凭据注入后门）。 */
  validateInvariants(): void {
    for (const h of this.injectHosts) {
      if (!this.allowedDomains.has(h)) {
        throw new Error(
          `injectHosts ⊈ allowedDomains: "${h}" not in allowedDomains (C5 invariant)`,
        );
      }
    }
  }

  /** sandbox 进程 env：strip 真实 secret，注入 sentinel。 */
  buildSandboxEnv(rawEnv: Record<string, string>): Record<string, string> {
    // 构造时即校验不变量（防绕过）。
    this.validateInvariants();
    return stripSecretEnv(rawEnv, { secrets: this.secrets, vault: this.vault });
  }

  /**
   * proxy egress：若 host ∈ injectHosts，用真实凭据重签请求（AWS host 走 SigV4）；
   * 否则透传 sentinel 并对混入的真实 secret 脱敏（真实值绝不出现在非 injectHost 出站）。
   */
  onEgress(req: EgressRequest): EgressRequest {
    // egress 前再校验不变量（防运行期策略漂移）。
    this.validateInvariants();

    if (this.injectHosts.has(req.host)) {
      return this.injectRealCredentials(req);
    }
    return this.redactNonInjectHost(req);
  }

  private injectRealCredentials(req: EgressRequest): EgressRequest {
    const headers: Record<string, string> = { ...req.headers };

    // AWS host 且具备 AWS 密钥 → SigV4 重签（真实 secret 仅参与 HMAC，不出现在明文）。
    const aws = this.resolveAws(req.host);
    const accessKey = this.secrets.get("AWS_ACCESS_KEY_ID");
    const secretKey = this.secrets.get("AWS_SECRET_ACCESS_KEY");
    if (aws !== undefined && accessKey !== undefined && secretKey !== undefined) {
      const signOpts: Parameters<typeof sigV4Sign>[0] = {
        method: req.method,
        url: req.url,
        headers,
        accessKey,
        secretKey,
        region: aws.region,
        service: aws.service,
      };
      if (typeof req.body === "string") {
        signOpts.body = req.body;
      }
      const signed = sigV4Sign(signOpts);
      return { host: req.host, method: req.method, url: req.url, headers: signed.headers, ...(req.body !== undefined ? { body: req.body } : {}) };
    }

    // 非 AWS injectHost：把 header/body 中的 sentinel 替换为真实凭据值。
    const replacedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      replacedHeaders[k] = this.replaceSentinels(v);
    }
    let body: string | undefined;
    if (typeof req.body === "string") {
      body = this.replaceSentinels(req.body);
    }
    if (body !== undefined) {
      return { host: req.host, method: req.method, url: req.url, headers: replacedHeaders, body };
    }
    return { host: req.host, method: req.method, url: req.url, headers: replacedHeaders };
  }

  private redactNonInjectHost(req: EgressRequest): EgressRequest {
    // 真实 secret 值集合（用于按值脱敏）。
    const secretValues: string[] = [];
    for (const v of this.secrets.values()) {
      if (v.length > 0) secretValues.push(v);
    }
    return redactEgressRequest(req, secretValues);
  }

  /** 把字符串中的 sentinel 子串替换为对应真实值（仅 injectHost egress 用）。 */
  private replaceSentinels(input: string): string {
    let out = input;
    // 遍历 vault 中所有 sentinel→real 映射做替换。
    // 注意：sentinel 形如 sentinel_<sessionId>_<norm>；逐条替换为真实值。
    for (const [realValue, sentinel] of this.iterSentinelPairs()) {
      if (sentinel.length === 0) continue;
      out = out.split(sentinel).join(realValue);
    }
    return out;
  }

  private *iterSentinelPairs(): IterableIterator<[string, string]> {
    // vault 内部映射不可直接枚举；通过 secrets 的 key 名查 sentinel，再 resolve 真实值。
    for (const [keyName, realValue] of this.secrets) {
      const sentinel = this.vault.sentinelFor(keyName);
      if (sentinel !== undefined) {
        yield [realValue, sentinel];
      }
    }
  }
}
