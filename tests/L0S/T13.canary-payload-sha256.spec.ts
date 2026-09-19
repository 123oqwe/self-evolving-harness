import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  EnvelopeRegistry,
  type EnvelopeParams,
} from "@harness/l0-sandbox";

/**
 * L0S-T13 · canary payload sha256 完整性
 *
 * Spec G/W/T：
 *   Given canary payload 被篡改；
 *   When  校验 sha256；
 *   Then  reject（throw）。
 *
 * EnvelopeParams.sha256 锁定 canaryPayloads 内容；篡改 payload 后 sha256 不匹配。
 */
function envWithSha(
  version: string,
  canaryPayloads: string[],
  sha: string,
): EnvelopeParams {
  return {
    version,
    canaryPayloads,
    archiveCapC: 50,
    acceptanceThreshold: 0.8,
    canaryRatio: 0.1,
    sha256: sha,
  };
}

describe("L0S-T13", () => {
  test("canary payload tampering rejected", () => {
    const reg = new EnvelopeRegistry();

    const payloads = ["exfil-curl", "ssh-read"];
    const goodSha = createHash("sha256")
      .update(JSON.stringify(payloads))
      .digest("hex");

    // 完整 → 通过。
    const intact = envWithSha("v1", payloads, goodSha);
    expect(() => reg.assertIntegrity(intact)).not.toThrow();

    // 篡改 payload（新增一项）但 sha256 未更新 → throw。
    const tampered = envWithSha(
      "v1",
      [...payloads, "metadata-curl"],
      goodSha,
    );
    expect(() => reg.assertIntegrity(tampered)).toThrow();
  });
});
