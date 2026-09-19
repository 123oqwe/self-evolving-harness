import { describe, test, expect } from "vitest";
import { MaskingProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04b · 边界（injectHosts ⊈ allowedDomains）
 *
 * Spec G/W/T:
 *   Given injectHosts 含 `evil.com` 不在 allowedDomains；
 *   When  new MaskingProxy({injectHosts:['evil.com'], allowedDomains:['api.github.com']})；
 *   Then  validateInvariants() throw（防 agent 自开凭据注入后门）。
 */
describe("L0S-T04b", () => {
  test("injectHosts not subset of allowedDomains throws", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["evil.com"],
      allowedDomains: ["api.github.com"],
      secrets: new Map(),
    });

    expect(() => proxy.validateInvariants()).toThrow();
  });

  test("injectHosts subset of allowedDomains passes invariants", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com"],
      allowedDomains: ["api.github.com", "s3.amazonaws.com"],
      secrets: new Map([["GITHUB_TOKEN", "ghp_real"]]),
    });

    expect(() => proxy.validateInvariants()).not.toThrow();
  });
});
