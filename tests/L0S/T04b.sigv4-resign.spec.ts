import { describe, test, expect } from "vitest";
import { MaskingProxy, sigV4Sign } from "@harness/l0-sandbox";

/**
 * L0S-T04b · SigV4 重签
 *
 * Spec G/W/T:
 *   Given sandbox 内对 s3.amazonaws.com 请求含 sentinel AWS key；
 *   When  proxy onEgress（host ∈ injectHosts）；
 *   Then  SigV4 重签成功（真实 secret 不出现在 sandbox，重签发生在 proxy/brain 域）。
 *
 * 同时直接单测 sigV4Sign：自实现精简 AWS SigV4（canonical request + string-to-sign +
 * HMAC-SHA256），签名 header 必须含 Authorization: AWS4-HMAC-SHA256 ...
 */
describe("L0S-T04b", () => {
  test("sigV4Sign produces AWS4 HMAC-SHA256 authorization header", () => {
    const signed = sigV4Sign({
      method: "GET",
      url: "https://s3.amazonaws.com/bucket/key",
      headers: { Host: "s3.amazonaws.com" },
      accessKey: "AKIAEXAMPLE",
      secretKey: "realSecret",
      region: "us-east-1",
      service: "s3",
    });

    // 签名结果必须含 AWS SigV4 授权头。
    expect(signed.headers.Authorization).toMatch(/AWS4-HMAC-SHA256/);
    expect(signed.headers.Authorization).toContain("AKIAEXAMPLE");
    // 必须含 signed headers 指示与 signature。
    expect(signed.headers["X-Amz-Date"]).toBeTruthy();
    expect(signed.headers.Authorization).toMatch(/Signature=[0-9a-f]+/);
    // 真实 secret 不应作为 header 值明文出现。
    expect(JSON.stringify(signed.headers)).not.toContain("realSecret");
  });

  test("SigV4 resign on injectHost", () => {
    const proxy = new MaskingProxy({
      injectHosts: ["s3.amazonaws.com"],
      allowedDomains: ["s3.amazonaws.com"],
      secrets: new Map([
        ["AWS_ACCESS_KEY_ID", "AKIAEXAMPLE"],
        ["AWS_SECRET_ACCESS_KEY", "realSecret"],
      ]),
    });

    const sandboxEnv = proxy.buildSandboxEnv({
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "realSecret",
    });
    // sandbox 侧只见 sentinel，不见真实 key。
    expect(JSON.stringify(sandboxEnv)).not.toContain("realSecret");

    // proxy 在 injectHost egress 时重签：用真实 secret 产生 SigV4 头。
    const req = proxy.onEgress({
      host: "s3.amazonaws.com",
      method: "GET",
      url: "https://s3.amazonaws.com/bucket/key",
      headers: { Authorization: `Bearer ${sandboxEnv.AWS_ACCESS_KEY_ID}` },
      body: "",
    });

    // 重签后的出站请求含 AWS SigV4 授权头（真实签名发生在 proxy/brain 域）。
    expect(req.headers.Authorization).toMatch(/AWS4-HMAC-SHA256/);
    expect(req.headers.Authorization).toContain("AKIAEXAMPLE");
  });
});
