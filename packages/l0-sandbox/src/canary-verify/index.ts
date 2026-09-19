/**
 * L0S-T05 — canary token 零泄漏验证器 [MVP]
 *
 * C5/canary 凭据零容忍（PRD §11.4）。向 sandbox 注入一个 canary token
 *（distinct from 真实 secret），监测所有非 injectHosts 出站 / sandbox
 * stdout+stderr / 可写文件 是否含 canary = 0 命中。这是确定性二值 oracle
 *（02-sandbox-security C5 score）。
 *
 * grep 范围（确定性）：
 *   (1) proxy egress 日志（redact 前的原始出站请求，由本验证器拦截 proxy.onEgress
 *       记录；host ∈ injectHosts 的 canary 命中不计入泄漏）；
 *   (2) sandbox 单次 runVerify 捕获的 stdout + stderr；
 *   (3) sandbox 可写文件目录 = FsRules.allowWrite 路径前缀下递归扫描（排除
 *       denyRead 路径，防自指探测）。
 *
 * ERRATA-w2plus L0S-T05：构造参数类型裁定为 MaskingProxy；egress 日志经本验证器
 * 拦截 onEgress 落内存记录（MaskingProxy 不持久化 egress log，本验证器在
 * redact 前抓取原始请求以捕获 exfil 企图）。verifyAfterRun() 无参。
 */

import type { EgressRequest, MaskingProxy } from "../credential-masking/masking-proxy.js";
import type { FsRules, OssandboxBackend } from "../os-sandbox/types.js";
import { injectCanaryEnv } from "./injector.js";
import {
  grepCapture,
  grepEgressRequest,
  grepFiles,
  type CanaryHit,
} from "./grep.js";

export interface CanaryLeakVerifierOpts {
  canaryToken: string;
  injectHosts: string[];
  proxy: MaskingProxy;
  sandbox: OssandboxBackend;
  fsRules: FsRules;
  allowWrite: string[];
}

export interface CanaryVerifyResult {
  leaked: boolean;
  hits: CanaryHit[];
}

export class CanaryLeakVerifier {
  private readonly canaryToken: string;
  private readonly injectHosts: Set<string>;
  private readonly proxy: MaskingProxy;
  private readonly sandbox: OssandboxBackend;
  private readonly fsRules: FsRules | undefined;
  private readonly allowWrite: string[];
  private readonly egressRecords: { host: string; req: EgressRequest }[] = [];
  private readonly originalOnEgress: (req: EgressRequest) => EgressRequest;
  private lastCapture: { stdout: string; stderr: string } | undefined;

  constructor(opts: CanaryLeakVerifierOpts) {
    this.canaryToken = opts.canaryToken;
    this.injectHosts = new Set(opts.injectHosts);
    this.proxy = opts.proxy;
    this.sandbox = opts.sandbox;
    // 防御性兜底：锁定测试构造时不传 fsRules/allowWrite，运行期按缺省空处理。
    this.fsRules = opts.fsRules as FsRules | undefined;
    this.allowWrite = (opts.allowWrite as string[] | undefined) ?? [];

    // 拦截 proxy.onEgress：在 redact 前记录原始出站请求，供 canary grep。
    // host ∈ injectHosts 的 canary 命中不计入泄漏（合法凭据注入出站）。
    this.originalOnEgress = this.proxy.onEgress.bind(this.proxy);
    const recorder = this.egressRecords;
    const original = this.originalOnEgress;
    this.proxy.onEgress = (req: EgressRequest): EgressRequest => {
      recorder.push({ host: req.host, req });
      return original(req);
    };
  }

  /**
   * 注入 canary 到 sandbox env（作为 pseudo-secret）。返回新 env 对象，
   * sandbox 见 sentinel 占位符，canary 真值不落 env。
   */
  inject(sandboxEnv: Record<string, string>): Record<string, string> {
    return injectCanaryEnv(sandboxEnv, this.canaryToken);
  }

  /**
   * 记录最近一次 sandbox runVerify 捕获的 stdout/stderr，供 verifyAfterRun
   * grep scope (2) 消费。调用方（如 L0S-T02 verify 流程）在 runVerify 后调用。
   */
  recordCapture(capture: { stdout: string; stderr: string }): void {
    this.lastCapture = { stdout: capture.stdout, stderr: capture.stderr };
  }

  /**
   * 验证 canary 零泄漏。遍历三个 grep 源，host ∈ injectHosts 的 egress 命中
   * 不计入。leaked = (hits.length > 0)。
   */
  verifyAfterRun(): CanaryVerifyResult {
    const hits: CanaryHit[] = [];
    const canary = this.canaryToken;
    if (!canary || canary.length === 0) {
      return { leaked: false, hits };
    }

    // (1) proxy egress 日志（redact 前原始请求）。
    for (const rec of this.egressRecords) {
      if (this.injectHosts.has(rec.host)) continue;
      for (const snippet of grepEgressRequest(rec.req, canary)) {
        hits.push({ location: `egress:${rec.host}`, snippet });
      }
    }

    // (2) sandbox stdout/stderr capture。
    if (this.lastCapture !== undefined) {
      for (const snippet of grepCapture(
        this.lastCapture.stdout,
        this.lastCapture.stderr,
        canary,
      )) {
        hits.push({ location: "sandbox:capture", snippet });
      }
    }

    // (3) sandbox 可写文件目录（allowWrite subtree，排除 denyRead）。
    if (this.allowWrite.length > 0) {
      const denyRead = this.fsRules?.denyRead ?? [];
      for (const h of grepFiles(this.allowWrite, denyRead, canary)) {
        hits.push(h);
      }
    }

    return { leaked: hits.length > 0, hits };
  }
}

export { injectCanaryEnv } from "./injector.js";
export {
  grepString,
  grepEgressRequest,
  grepCapture,
  grepFiles,
} from "./grep.js";
export type { CanaryHit } from "./grep.js";
