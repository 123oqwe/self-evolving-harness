/**
 * L0S-T08 — net-policies barrel（NetPolicyRegistry + 类型导出）
 *
 * C2 网络策略三表（denyRead 路径集 / allowedDomains / denyOutCidr）版本化进化：
 *   - deny 收紧（新增 deny 项）= 元循环自动；
 *   - allow 放宽（新增 allow 域 / 移除 deny CIDR）须人工签发
 *     （防 agent 自开 exfil 后门）。
 *
 * 裁决 L0S-08：`assertChangeAllowed(diff, next)` 同时收 diff 与 next；
 *   signoff 读自 next（next.signoffs）。
 *   `Signoff` 类型为 T08/T11/T12 共享导出。
 *   构造器统一 DI：`{ trustedSigners, verifySignoff }`。
 *
 * refix1 安全加固：
 *   - denyRead 单调收紧：`diff.denyReadRelaxed` 非空即 throw（fail-closed），
 *     即使有人工签发也不放行凭据黑名单收缩（防 exfil 后门）。
 *   - allow/denyOut 放宽签发用结构化 expectedChange（`"add <域>"` /
 *     `"remove <CIDR>"`）精确匹配，防跨方向签发复用。
 */

export type { Signoff, VerifySignoffFn, ChangeSignoffOpts } from "./signoff.js";
export { ChangeSignoff } from "./signoff.js";
export type { PolicyDiff } from "./diff.js";
export { diffNetPolicy } from "./diff.js";

import { diffNetPolicy } from "./diff.js";
import { ChangeSignoff } from "./signoff.js";
import type { PolicyDiff } from "./diff.js";
import type { Signoff, VerifySignoffFn, ChangeSignoffOpts } from "./signoff.js";

/** 网络策略：三表 + 签发记录。 */
export interface NetPolicy {
  version: string;
  /** deny-read 路径集（文件读取黑名单）。 */
  denyRead: string[];
  /** 允许出口域名 allowlist。 */
  allowedDomains: string[];
  /** deny-out CIDR 集（IP/CIDR 黑名单）。 */
  denyOutCidr: string[];
  /** 人工签发记录（覆盖 allow 放宽变更）。 */
  signoffs: Signoff[];
}

/** NetPolicyRegistry 构造选项（DI）。 */
export interface NetPolicyRegistryOpts {
  /** 可信签发人 allowlist。 */
  trustedSigners: string[];
  /** 可注入的签发验证函数（缺省 fail-closed，须注入真实 ssh-keygen -Y verify）。 */
  verifySignoff?: VerifySignoffFn;
}

/**
 * 网络策略注册表：三表 diff + 收紧/放宽分类 + 签发 gate。
 *
 * - `diff`：计算 prev → next 的三表差集（deny 收紧 / allow 放宽）。
 * - `assertChangeAllowed`：deny 收紧自动放行；denyRead 收缩 throw（单调收紧）；
 *   allow 放宽（新增 allow 域 / 移除 deny CIDR）须 next.signoffs 含可信签发，
 *   否则 throw。
 */
export class NetPolicyRegistry {
  private readonly signoff: ChangeSignoff;

  constructor(opts: NetPolicyRegistryOpts) {
    const signoffOpts: ChangeSignoffOpts = {
      trustedSigners: opts.trustedSigners,
    };
    if (opts.verifySignoff !== undefined) {
      signoffOpts.verifySignoff = opts.verifySignoff;
    }
    this.signoff = new ChangeSignoff(signoffOpts);
  }

  /** 计算 prev → next 的三表 diff。 */
  diff(prev: NetPolicy, next: NetPolicy): PolicyDiff {
    return diffNetPolicy(prev, next);
  }

  /**
   * 断言变更方向被允许：
   *   - denyRead 收缩（denyReadRelaxed 非空）→ throw（单调收紧，fail-closed，
   *     防凭据黑名单被删开 exfil 后门，即使有签发也不放行）；
   *   - deny 收紧（denyTightened / denyOutTightened）→ 自动放行；
   *   - allow 放宽（allowRelaxed / denyOutRelaxed）→ 须 next.signoffs 含
   *     可信签发，以结构化 `"<verb> <target>"` 精确匹配覆盖每个放宽项，
   *     否则 throw。
   *
   * @throws denyRead 收缩 / allow 放宽无可信签发覆盖时 throw
   */
  assertChangeAllowed(diff: PolicyDiff, next: NetPolicy): void {
    // denyRead 单调收紧：prev - next 非空即拒绝（exfil-enabling，不可签发放宽）。
    if (diff.denyReadRelaxed.length > 0) {
      throw new Error(
        `denyRead may only tighten (monotonic); shrink forbidden (exfil-enabling): ` +
          `${diff.denyReadRelaxed.join(", ")}`,
      );
    }

    // allow 放宽（新增 allow 域）：须签发，结构化 expectedChange = "add <域>"。
    for (const domain of diff.allowRelaxed) {
      this.signoff.assertSigned(next.signoffs, `add ${domain}`);
    }
    // denyOut 放宽（移除 deny CIDR）：须签发，结构化 expectedChange = "remove <CIDR>"。
    for (const cidr of diff.denyOutRelaxed) {
      this.signoff.assertSigned(next.signoffs, `remove ${cidr}`);
    }
  }
}
