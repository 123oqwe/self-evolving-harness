import { describe, test, expect } from "vitest";
import {
  EscapePayloadSuite,
  type OssandboxBackend,
  type RunVerifyOptions,
  type VerifyResult,
} from "@harness/l0-sandbox";

/**
 * L0S-T14 · /etc/passwd 读被阻断
 *
 * Spec G/W/T:
 *   Given denyRead /etc/passwd；When payload `cat /etc/passwd`；
 *   Then  escaped=false，epermHit=true。
 *
 * macOS/Linux 通用敏感路径前缀 /etc。
 */
describe("L0S-T14", () => {
  test("/etc/passwd blocked", async () => {
    const backend: OssandboxBackend = {
      platform: "none",
      async runVerify(cmd: string): Promise<VerifyResult> {
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

    const etcHit = results.find(
      (r) => r.id.includes("etc") || r.id.includes("passwd"),
    );
    expect(etcHit).toBeDefined();
    expect(etcHit?.escaped).toBe(false);
    expect(etcHit?.epermHit).toBe(true);
  });
});
