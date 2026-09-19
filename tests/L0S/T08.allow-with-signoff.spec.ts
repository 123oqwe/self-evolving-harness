import { describe, test, expect } from "vitest";
import { NetPolicyRegistry, type NetPolicy } from "@harness/l0-sandbox";

/**
 * L0S-T08 · 错误路径（allow 新增有人工签发 → 通过）
 *
 * Spec G/W/T:
 *   Given v2 含 signoffs:[{change:'add evil.com', signature:'ssh-sig...', signer:'security@team'}]；
 *   When  assertChangeAllowed；
 *   Then  通过（签发验证成功）。
 *
 * 注：真实 SSH 签名验证（ssh-keygen -Y verify）由 GREEN 实现完成；本测试在
 * registry 构造时注入 trustedSigners allowlist + 可注入 verifySignoff，以确定性
 * 检验「可信签发人 + 匹配 change」放行路径。真实密码学验证见 ambiguities。
 */
function pol(version: string, opts: Partial<NetPolicy> = {}): NetPolicy {
  return {
    version,
    denyRead: opts.denyRead ?? [],
    allowedDomains: opts.allowedDomains ?? [],
    denyOutCidr: opts.denyOutCidr ?? [],
    signoffs: opts.signoffs ?? [],
  };
}

describe("L0S-T08", () => {
  test("allow new domain with valid signoff accepted", () => {
    // 注入可确定性的签发验证：trusted signer + 非空签名 + change 匹配即放行。
    const reg = new NetPolicyRegistry({
      trustedSigners: ["security@team"],
      verifySignoff: (s) =>
        s.signer === "security@team" && s.signature.length > 0,
    });

    const v1 = pol("v1", { allowedDomains: ["api.github.com"] });
    const v2 = pol("v2", {
      allowedDomains: ["api.github.com", "evil.com"],
      signoffs: [
        {
          change: "add evil.com",
          signature: "ssh-sig-real",
          signer: "security@team",
        },
      ],
    });

    const d = reg.diff(v1, v2);
    expect(d.allowRelaxed).toContain("evil.com");

    // 可信签发人 + 匹配 change → 放行。
    expect(() => reg.assertChangeAllowed(d, v2)).not.toThrow();
  });
});
