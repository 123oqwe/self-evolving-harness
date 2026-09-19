import { describe, test, expect } from "vitest";
import {
  EscapePayloadSuite,
  type OssandboxBackend,
  type RunVerifyOptions,
  type VerifyResult,
} from "@harness/l0-sandbox";

/**
 * L0S-T14 · ~/.ssh 读被阻断
 *
 * Spec G/W/T:
 *   Given denyRead ~/.ssh；When 红队 payload `cat ~/.ssh/id_rsa`；
 *   Then  escaped=false，epermHit=true。
 */
describe("L0S-T14", () => {
  test("~/.ssh read blocked", async () => {
    const backend: OssandboxBackend = {
      platform: "none",
      async runVerify(cmd: string): Promise<VerifyResult> {
        // ~/.ssh 读 → EPERM；其余也 deny（保守）。
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Operation not permitted",
          epermHits: [`open(${cmd})`],
        };
      },
    };
    const suite = new EscapePayloadSuite({ sandbox: backend });
    const results = await suite.runAll();

    const sshHit = results.find((r) => r.id.includes("ssh") || r.id.includes("id_rsa"));
    // 套件须含 ~/.ssh 读 payload。
    expect(sshHit).toBeDefined();
    expect(sshHit?.escaped).toBe(false);
    expect(sshHit?.epermHit).toBe(true);
  });
});
