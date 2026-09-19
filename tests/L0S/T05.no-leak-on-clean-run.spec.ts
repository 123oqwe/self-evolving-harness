import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CanaryLeakVerifier,
  MaskingProxy,
  NoneBackend,
  type FsRules,
  type NetRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T05 · 正常路径（零泄漏）
 *
 * Spec G/W/T:
 *   Given 注入 canary token 到 sandbox env + sentinel 映射表；
 *   When  sandbox 内运行正常工作负载（不出站或仅出站到 injectHosts）；
 *   Then  verifyAfterRun().leaked=false，所有 egress log / stdout / stderr /
 *        可写文件 grep canary = 0 命中。
 */
describe("L0S-T05", () => {
  let allowWriteDir: string;

  beforeEach(() => {
    allowWriteDir = mkdtempSync(join(tmpdir(), "l0s-t05-clean-"));
  });
  afterEach(() => rmSync(allowWriteDir, { recursive: true, force: true }));

  test("clean run leaks zero canary", async () => {
    const proxy = new MaskingProxy({
      injectHosts: ["api.github.com"],
      allowedDomains: ["api.github.com"],
      secrets: new Map([["GITHUB_TOKEN", "ghp_real"]]),
    });
    const sandbox = new NoneBackend();

    const verifier = new CanaryLeakVerifier({
      canaryToken: "canary-xyz-123",
      injectHosts: ["api.github.com"],
      proxy,
      sandbox,
    });

    const sandboxEnv = verifier.inject({ PATH: "/usr/bin" });
    // canary 已作为 pseudo-secret 注入（值或 sentinel 形式），但本测试只关心
    // 是否泄漏到出站/文件/stdout——clean run 不应产生任何 canary 命中。

    // 可写目录内不含 canary。
    writeFileSync(join(allowWriteDir, "out.txt"), "hello world");

    const result = await verifier.verifyAfterRun();

    expect(result.leaked).toBe(false);
    expect(result.hits).toHaveLength(0);
  });
});
