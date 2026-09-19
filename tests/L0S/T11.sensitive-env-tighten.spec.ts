import { describe, test, expect } from "vitest";
import {
  CredentialPolicyRegistry,
  type CredentialPolicy,
} from "@harness/l0-sandbox";

/**
 * L0S-T11 · 正常路径（敏感 env pattern 收紧自动）
 *
 * Spec G/W/T:
 *   Given v2 增加敏感 env pattern `.*_PRIVATE_KEY`；
 *   When  diff；
 *   Then  sensitiveEnvAdded 非空，assertChangeAllowed 通过（脱敏收紧自动）。
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
  test("sensitive env pattern add auto-allowed", () => {
    const reg = new CredentialPolicyRegistry({
      allowedDomains: ["api.github.com"],
      trustedSigners: [],
    });

    const v1 = pol("v1", { sensitiveEnvPatterns: ["^TOKEN$"] });
    const v2 = pol("v2", {
      sensitiveEnvPatterns: ["^TOKEN$", ".*_PRIVATE_KEY"],
    });

    const d = reg.diff(v1, v2);
    expect(d.sensitiveEnvAdded).toContain(".*_PRIVATE_KEY");

    // 脱敏收紧不需签发 → 通过。
    expect(() => reg.assertChangeAllowed(d, v2)).not.toThrow();
  });

  test("redactRules tighten auto-allowed", () => {
    const reg = new CredentialPolicyRegistry({
      allowedDomains: ["api.github.com"],
      trustedSigners: [],
    });

    const v1 = pol("v1", {
      redactRules: { header: ["Authorization"], bodyField: [] },
    });
    const v2 = pol("v2", {
      redactRules: {
        header: ["Authorization", "X-Api-Key"],
        bodyField: ["password"],
      },
    });

    const d = reg.diff(v1, v2);
    expect(d.redactRulesTightened.length).toBeGreaterThan(0);
    expect(() => reg.assertChangeAllowed(d, v2)).not.toThrow();
  });
});
