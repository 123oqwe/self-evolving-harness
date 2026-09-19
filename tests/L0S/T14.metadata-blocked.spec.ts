import { describe, test, expect } from "vitest";
import {
  EscapePayloadSuite,
  type OssandboxBackend,
  type RunVerifyOptions,
  type VerifyResult,
} from "@harness/l0-sandbox";

/**
 * L0S-T14 · cloud metadata 被阻断
 *
 * Spec G/W/T:
 *   Given payload `curl http://169.254.169.254/latest/meta-data/`；
 *   When  run；
 *   Then  escaped=false（IP 命中 denyOut CIDR）。
 */
describe("L0S-T14", () => {
  test("169.254.169.254 blocked", async () => {
    const backend: OssandboxBackend = {
      platform: "none",
      async runVerify(cmd: string): Promise<VerifyResult> {
        // metadata IP 命中 denyOut → 拒绝。
        const isMetadata = cmd.includes("169.254.169.254");
        return {
          exitCode: 1,
          stdout: "",
          stderr: isMetadata ? "Connection refused" : "Operation not permitted",
          epermHits: [cmd],
        };
      },
    };
    const suite = new EscapePayloadSuite({ sandbox: backend });
    const results = await suite.runAll();

    const metaHit = results.find(
      (r) => r.id.includes("metadata") || r.id.includes("169.254"),
    );
    expect(metaHit).toBeDefined();
    expect(metaHit?.escaped).toBe(false);
  });
});
