/**
 * L0S-T08 — 人工签发 gate（ChangeSignoff 通用类）
 *
 * allow 放宽（新增 allowlist 域 / 移除 deny CIDR）须人工签发，防 agent 自开
 * exfil 后门。签发机制：spec 要求 `ssh-keygen -Y verify` 真实 SSH 签名验证；
 * 确定性单测注入 `trustedSigners: string[]` + 可注入 `verifySignoff` 函数，
 * 真实 ssh-keygen 路径需临时 ed25519 keypair + CI ssh-keygen 可用。
 *
 * REFACTOR：`ChangeSignoff` 抽为通用类，T11（CredentialPolicy injectHosts）
 * 与 T12（HandsReplacementRegistry）共享复用（ERRATA-w2plus L0S-20）。
 *
 * refix1 安全加固：
 *   - change 匹配改精确结构化匹配（`change` 须为完整 `"<verb> <target>"` 字符串，
 *     与调用方传入的 expectedChange 完全相等）。此前 `String.includes` 子串匹配
 *     致跨变更碰撞/复用绕过（如 signoff.change='remove evil.com' 可放行
 *     expectedChange='evil.com'，deny 收紧签发被复用授权 allow 放宽）。
 *   - `defaultVerify` 改 fail-closed：未注入 `verifySignoff` 时 throw，绝不作为
 *     生产放行路径（此前仅校验 signature.length>0 违反 silence≠approve 与 spec
 *     「ssh-keygen -Y verify 真实验证」）。确定性单测须注入 verifySignoff。
 */

/** 签发记录：change 描述 + 签名 + 签发人。T08/T11/T12 共享导出。 */
export interface Signoff {
  /**
   * 变更描述（结构化 `"<verb> <target>"`，须与待放行变更精确相等）。
   * 例：allow 新增域 → `"add evil.com"`；移除 deny CIDR → `"remove 0.0.0.0/0"`。
   * verb 编码变更方向，防跨方向签发复用。
   */
  change: string;
  /** SSH 签名（`ssh-keygen -Y sign` 产出）或注入的确定性标记。 */
  signature: string;
  /** 签发人标识（须 ∈ trustedSigners）。 */
  signer: string;
}

/** 签发验证函数：给定签发记录，返回是否通过验证。 */
export type VerifySignoffFn = (s: Signoff) => boolean;

/** ChangeSignoff 构造选项。 */
export interface ChangeSignoffOpts {
  /** 可信签发人 allowlist（签发人标识集合）。 */
  trustedSigners: string[];
  /**
   * 可注入的签发验证函数。缺省 fail-closed（throw）：未注入时拒绝放行，
   * 逼真实 `ssh-keygen -Y verify` 经调用方注入（spec 要求密码学验证）。
   * 确定性单测注入函数覆盖。
   */
  verifySignoff?: VerifySignoffFn;
}

/**
 * 通用签发 gate：校验给定变更已被可信签发人签发。
 *
 * 校验规则：
 *   1. 至少一条 signoff；
 *   2. signoff.signer ∈ trustedSigners；
 *   3. verifySignoff(signoff) 返回 true（密码学/确定性验证）；
 *   4. signoff.change 精确等于待放行变更描述 expectedChange（结构化精确匹配，
 *      防子串碰撞/跨方向复用）。
 *
 * 任一不满足 → throw。
 */
export class ChangeSignoff {
  private readonly trustedSigners: Set<string>;
  private readonly verify: VerifySignoffFn;

  constructor(opts: ChangeSignoffOpts) {
    this.trustedSigners = new Set(opts.trustedSigners);
    this.verify = opts.verifySignoff ?? defaultVerify;
  }

  /**
   * 断言至少一条可信签发覆盖了 `expectedChange`。
   *
   * `expectedChange` 须为完整结构化字符串（如 `"add evil.com"`），与 signoff.change
   * 精确相等才命中——杜绝子串匹配跨变更复用。
   *
   * @throws 无签发 / 签发人不可信 / 验证失败 / change 不匹配
   */
  assertSigned(signoffs: Signoff[], expectedChange: string): void {
    if (signoffs.length === 0) {
      throw new Error(
        `signoff required for relaxed change "${expectedChange}" (无签发)`,
      );
    }
    for (const s of signoffs) {
      if (!this.trustedSigners.has(s.signer)) {
        // 不可信签发人 → 跳过（继续寻找可信签发）。
        continue;
      }
      if (!this.verify(s)) {
        continue;
      }
      // 精确结构化匹配：signoff.change 须为完整 expectedChange 字符串。
      // 杜绝子串匹配碰撞（如 "remove evil.com" 复用授权 "add evil.com"）。
      if (s.change !== expectedChange) {
        continue;
      }
      // 命中：可信签发人 + 验证通过 + change 精确匹配 → 放行。
      return;
    }
    throw new Error(
      `signoff verification failed for change "${expectedChange}" (无可信签发或 change 不匹配)`,
    );
  }
}

/**
 * 缺省验证：fail-closed。
 *
 * 真实路径须 `ssh-keygen -Y verify`（解析 s.signature 的 ssh-sig + s.change 作被签
 * 消息 + allowed_signers），由调用方经构造器注入 `verifySignoff` 提供。未注入时
 * 缺省路径 throw——绝不以「非空签名」静默放行（违反 silence≠approve 与 spec
 * 「ssh-keygen -Y verify 真实验证」）。确定性单测须注入 verifySignoff。
 */
const defaultVerify: VerifySignoffFn = () => {
  throw new Error(
    "signoff verification not configured: inject `verifySignoff` " +
      "(ssh-keygen -Y verify) for production; default path refuses to authorize " +
      "(fail-closed, silence≠approve)",
  );
};
