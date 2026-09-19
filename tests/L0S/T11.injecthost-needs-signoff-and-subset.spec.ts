import { describe, test, expect } from "vitest";
import {
  CredentialPolicyRegistry,
  type CredentialPolicy,
} from "@harness/l0-sandbox";

/**
 * L0S-T11 · 边界（injectHosts 新增须签发 + ⊆ allowedDomains）
 *
 * Spec G/W/T:
 *   Given v2 加 injectHost `evil.com`（不在 allowedDomains）无签发 → throw；
 *   Given 加 `api.github.com` ∈ allowedDomains 且有签发 → 通过。
 */
function pol(version: string, opts: Partial<CredentialPolicy> = {}): CredentialPolicy {
  return {
    version,
    injectHosts: opts.injectHosts ?? [],
    redactRules: opts.redactRules ?? { header: [], bodyField: [] },
    sensitiveEnvPatterns: opts.sensitiveEnvPatterns ?? [],
    signoffs: opts.signoffs ?? [],
  };
}

describe("L0S-T11", () => {
  test("new injectHost needs signoff + ⊆ allowedDomains", () => {
    const reg = new CredentialPolicyRegistry({
      allowedDomains: ["api.github.com", "s3.amazonaws.com"],
      trustedSigners: ["security@team"],
      verifySignoff: (s) =>
        s.signer === "security@team" && s.signature.length > 0,
    });

    // 1) injectHost 不在 allowedDomains + 无签发 → throw。
    const v1 = pol("v1", { injectHosts: [] });
    const v2bad = pol("v2", {
      injectHosts: ["evil.com"],
      signoffs: [
        { change: "add evil.com", signature: "ssh-sig", signer: "security@team" },
      ],
    });
    const dBad = reg.diff(v1, v2bad);
    expect(dBad.injectHostsAdded).toContain("evil.com");
    expect(() => reg.assertChangeAllowed(dBad, v2bad)).toThrow();

    // 2) injectHost 在 allowedDomains + 可信签发 → 通过。
    const v2good = pol("v2", {
      injectHosts: ["api.github.com"],
      signoffs: [
        {
          change: "add api.github.com",
          signature: "ssh-sig-real",
          signer: "security@team",
        },
      ],
    });
    const dGood = reg.diff(v1, v2good);
    expect(dGood.injectHostsAdded).toContain("api.github.com");
    expect(() => reg.assertChangeAllowed(dGood, v2good)).not.toThrow();

    // 3) injectHost 在 allowedDomains 但无签发 → throw。
    const v2nosig = pol("v2", { injectHosts: ["api.github.com"] });
    const dNoSig = reg.diff(v1, v2nosig);
    expect(() => reg.assertChangeAllowed(dNoSig, v2nosig)).toThrow();
  });
});
