import { describe, test, expect } from "vitest";
import {
  EscapePayloadSuite,
  type OssandboxBackend,
  type RunVerifyOptions,
  type VerifyResult,
} from "@harness/l0-sandbox";

/**
 * L0S-T14 · 红队 0 逃逸门
 *
 * Spec G/W/T:
 *   Given 完整 sandbox 配置（denyRead ~/.ssh+/etc/passwd+/etc，denyOut 0.0.0.0/0，allowedDomains=[]）；
 *   When  runAll；
 *   Then  所有 payload escaped=false，assertZeroEscape 通过。
 *   Given 一个 payload escaped=true；When assertZeroEscape；Then throw。
 *
 * 用一个「全 deny」stub backend 模拟完整 sandbox 链路（真实逃逸门由 verify.sh 覆盖）。
 */
function denyingBackend(): OssandboxBackend {
  return {
    platform: "none",
    async runVerify(
      _cmd: string,
      _opts: RunVerifyOptions,
    ): Promise<VerifyResult> {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Operation not permitted",
        epermHits: ["open(denied)"],
      };
    },
  };
}

describe("L0S-T14", () => {
  test("all payloads blocked, zero escape", async () => {
    const suite = new EscapePayloadSuite({ sandbox: denyingBackend() });
    const results = await suite.runAll();

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.escaped).toBe(false);
    }
    // 0 逃逸门通过。
    expect(() => suite.assertZeroEscape(results)).not.toThrow();

    // 任何一个 escaped=true → throw。
    const withEscape = results.map((r, i) =>
      i === 0 ? { ...r, escaped: true } : r,
    );
    expect(() => suite.assertZeroEscape(withEscape)).toThrow();
  });

  test("permissive backend surfaces escaped payload (suite reads backend)", async () => {
    // 放行后端：所有 payload exit 0 + 返回内容 → 套件须报告 escaped=true。
    // 阻断「空壳 runAll 恒返回 escaped=false」蒙混：套件必须真正调用 backend。
    const permissive: OssandboxBackend = {
      platform: "none",
      async runVerify(
        _cmd: string,
        _opts: RunVerifyOptions,
      ): Promise<VerifyResult> {
        return {
          exitCode: 0,
          stdout: "LEAKED PRIVATE MATERIAL",
          stderr: "",
          epermHits: [],
        };
      },
    };
    const suite = new EscapePayloadSuite({ sandbox: permissive });
    const results = await suite.runAll();

    expect(results.length).toBeGreaterThan(0);
    // 放行后端 → 至少一个 payload 逃逸成功（套件必须真正调用 backend 判定）。
    expect(results.some((r) => r.escaped === true)).toBe(true);
    // 0 逃逸门必须拒绝。
    expect(() => suite.assertZeroEscape(results)).toThrow();
  });
});
