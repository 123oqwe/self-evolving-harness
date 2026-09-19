import { describe, test, expect } from "vitest";
import { MaskingProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04b · 正常路径（env strip）
 *
 * Spec G/W/T:
 *   Given secrets {'GITHUB_TOKEN':'ghp_real', ...}, injectHosts ⊆ allowedDomains；
 *   When  buildSandboxEnv(rawEnv)；
 *   Then  返回 env 中 GITHUB_TOKEN='sentinel_...'（真实值不在）。
 */
describe("L0S-T04b", () => {
  test("env strip replaces real secret with sentinel", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com", "s3.amazonaws.com"],
      allowedDomains: ["api.github.com", "s3.amazonaws.com"],
      secrets: new Map([
        ["GITHUB_TOKEN", "ghp_real"],
        ["AWS_SECRET_ACCESS_KEY", "real"],
      ]),
    });

    const sandboxEnv = proxy.buildSandboxEnv({
      GITHUB_TOKEN: "ghp_real",
      AWS_SECRET_ACCESS_KEY: "real",
      PATH: "/usr/bin:/bin",
      HOME: "/sandbox/home",
    });

    // 真实值必须不出现在 sandbox env。
    expect(JSON.stringify(sandboxEnv)).not.toContain("ghp_real");
    expect(JSON.stringify(sandboxEnv)).not.toContain("AWS_SECRET_ACCESS_KEY\":\"real");
    // 占位符存在（名字保留，值被替换为 sentinel）。
    expect(sandboxEnv.GITHUB_TOKEN).not.toBe("ghp_real");
    expect(sandboxEnv.GITHUB_TOKEN.length).toBeGreaterThan(0);
    // 非敏感 env 透传。
    expect(sandboxEnv.PATH).toBe("/usr/bin:/bin");
    expect(sandboxEnv.HOME).toBe("/sandbox/home");
  });
});
