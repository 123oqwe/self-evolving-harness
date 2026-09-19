import { describe, test, expect } from "vitest";
import {
  HandsReplacementRegistry,
  type HandsImpl,
  type Action,
  type Observation,
} from "@harness/l0-sandbox";

/**
 * L0S-T12 · 错误路径（无签发）
 *
 * Spec G/W/T:
 *   Given newImpl 无 signoff；
 *   When  replace；
 *   Then  throw（须人工签发）。
 */
describe("L0S-T12", () => {
  test("replacement without signoff rejected", async () => {
    const reg = new HandsReplacementRegistry({
      trustedSigners: ["security@team"],
      verifySignoff: (s) =>
        s.signer === "security@team" && s.signature.length > 0,
      escapeSuite: [],
    });

    const noSignoff: HandsImpl = {
      name: "bash",
      version: "v2",
      impl: async (a: Action): Promise<Observation> => ({
        tool_use_id: a.tool_use_id,
        content: "",
        exit_code: 0,
        stdout: "",
        stderr: "",
      }),
      signoffs: [],
    };

    await expect(
      reg.replace("bash", noSignoff, []),
    ).rejects.toThrow();
  });
});
