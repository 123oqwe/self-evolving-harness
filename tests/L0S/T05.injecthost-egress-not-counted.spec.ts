import { describe, test, expect } from "vitest";
import { CanaryLeakVerifier, MaskingProxy, NoneBackend } from "@harness/l0-sandbox";

/**
 * L0S-T05 · 边界（canary 经 injectHosts 出站不算泄漏）
 *
 * Spec G/W/T:
 *   Given injectHosts=['api.github.com']，sandbox 内对 api.github.com 请求含 canary；
 *   When  proxy onEgress 替换为「真实值」（canary 即真实值）；
 *   Then  egress log 到 api.github.com 的 canary 命中不计入泄漏（host ∈ injectHosts），leaked=false。
 */
describe("L0S-T05", () => {
  test("canary to injectHost not counted as leak", async () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com"],
      allowedDomains: ["api.github.com"],
      secrets: new Map([["GITHUB_TOKEN", "canary-xyz-123"]]),
    });
    const sandbox = new NoneBackend();

    const verifier = new CanaryLeakVerifier({
      canaryToken: "canary-xyz-123",
      injectHosts: ["api.github.com"],
      proxy,
      sandbox,
    });

    verifier.inject({ GITHUB_TOKEN: "canary-xyz-123" });

    // canary 直接出现在到 injectHost 的出站请求中（无论 proxy 是否注入真实值，
    // canary 都会落到 egress 审计）→ 验证 host ∈ injectHosts 的 canary 命中
    // 不被计入泄漏。这样即使 onEgress 透传实现也能测到排除逻辑。
    proxy.onEgress({
      host: "api.github.com",
      method: "GET",
      url: "https://api.github.com/user",
      headers: { Authorization: "Bearer canary-xyz-123" },
      body: "",
    });

    const result = await verifier.verifyAfterRun();

    // host ∈ injectHosts 的 canary 命中不计入泄漏。
    expect(result.leaked).toBe(false);
  });
});
