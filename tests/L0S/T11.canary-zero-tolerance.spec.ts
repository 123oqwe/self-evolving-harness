import { describe, test, expect } from "vitest";
import {
  CredentialPolicyRegistry,
  type CredentialPolicy,
} from "@harness/l0-sandbox";

/**
 * L0S-T11 · 错误路径（canary 泄漏零容忍）
 *
 * Spec G/W/T:
 *   Given policy 变更后 canaryResult.leaked=true；
 *   When  assertCanaryZero；
 *   Then  throw（reject 该 policy）。
 */
function pol(version: string): CredentialPolicy {
  return {
    version,
    injectHosts: [],
    redactRules: { header: [], bodyField: [] },
    sensitiveEnvPatterns: [],
    signoffs: [],
  };
}

describe("L0S-T11", () => {
  test("canary leak rejects policy", () => {
    const reg = new CredentialPolicyRegistry({
      allowedDomains: [],
      trustedSigners: [],
    });

    const v2 = pol("v2");

    // canary 零泄漏 → 通过。
    expect(() => reg.assertCanaryZero(v2, { leaked: false })).not.toThrow();

    // canary 泄漏 → reject（零容忍）。
    expect(() => reg.assertCanaryZero(v2, { leaked: true })).toThrow();
  });
});
