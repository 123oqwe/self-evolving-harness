import { describe, test, expect } from "vitest";
import { NetPolicyRegistry, type NetPolicy } from "@harness/l0-sandbox";

/**
 * L0S-T08 · 边界（allow 新增无签发）
 *
 * Spec G/W/T:
 *   Given v1 allowedDomains=['api.github.com']；
 *   When  v2 加 `evil.com` 无 signoff；
 *   Then  allowRelaxed=['evil.com']，assertChangeAllowed throw。
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
  test("allow new domain without signoff rejected", () => {
    const reg = new NetPolicyRegistry({ trustedSigners: ["security@team"] });

    const v1 = pol("v1", { allowedDomains: ["api.github.com"] });
    const v2 = pol("v2", {
      allowedDomains: ["api.github.com", "evil.com"],
      // 无 signoff
    });

    const d = reg.diff(v1, v2);
    expect(d.allowRelaxed).toContain("evil.com");

    expect(() => reg.assertChangeAllowed(d, v2)).toThrow();
  });

  test("allow new domain with untrusted signer rejected", () => {
    const reg = new NetPolicyRegistry({ trustedSigners: ["security@team"] });

    const v1 = pol("v1", { allowedDomains: ["api.github.com"] });
    const v2 = pol("v2", {
      allowedDomains: ["api.github.com", "evil.com"],
      signoffs: [
        {
          change: "add evil.com",
          signature: "ssh-sig-bogus",
          signer: "untrusted@attacker",
        },
      ],
    });

    const d = reg.diff(v1, v2);
    expect(d.allowRelaxed).toContain("evil.com");
    // signer 不在 trustedSigners → reject。
    expect(() => reg.assertChangeAllowed(d, v2)).toThrow();
  });
});
