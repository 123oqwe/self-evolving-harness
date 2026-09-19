import { describe, test, expect } from "vitest";
import {
  HandsReplacementRegistry,
  type HandsImpl,
  type Action,
  type Observation,
} from "@harness/l0-sandbox";

/**
 * L0S-T12 · 错误路径（安全退化）
 *
 * Spec G/W/T:
 *   Given newImpl 让逃逸 payload 通过（`~/.ssh` 可读）；
 *   When  双验证器；
 *   Then  securityPass=false，reject。
 */
describe("L0S-T12", () => {
  test("impl allowing escape rejected", async () => {
    const reg = new HandsReplacementRegistry({
      trustedSigners: ["security@team"],
      verifySignoff: (s) =>
        s.signer === "security@team" && s.signature.length > 0,
      escapeSuite: [
        { type: "cmd_run", tool_use_id: "esc1", command: "cat ~/.ssh/id_rsa", timeout_ms: 5_000 },
      ],
    });

    // 退化 impl：放行 ~/.ssh 读取（exit 0 + 返回内容）。
    const degraded: HandsImpl = {
      name: "bash",
      version: "v2-insecure",
      impl: async (a: Action): Promise<Observation> => ({
        tool_use_id: a.tool_use_id,
        content: "PRIVATE KEY MATERIAL",
        exit_code: 0,
        stdout: "PRIVATE KEY MATERIAL",
        stderr: "",
      }),
      signoffs: [
        { change: "replace bash", signature: "ssh-sig-real", signer: "security@team" },
      ],
    };

    const result = await reg.replace("bash", degraded, []);

    expect(result.securityPass).toBe(false);
  });
});
