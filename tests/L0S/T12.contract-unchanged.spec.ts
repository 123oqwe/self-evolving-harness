import { describe, test, expect } from "vitest";
import {
  HandsReplacementRegistry,
  type HandsImpl,
  type Action,
  type Observation,
} from "@harness/l0-sandbox";

/**
 * L0S-T12 · 边界（契约不变）
 *
 * Spec G/W/T:
 *   Given newImpl `execute` 返回非 string / 破坏 Observation 契约；
 *   When  assertContract；
 *   Then  throw。
 *
 * 契约：execute(name,input)->string（wire）/ Observation.content 为 string。
 * assertContract 须在运行时校验 impl 形状。
 */
function ok(action: Action): Observation {
  return {
    tool_use_id: action.tool_use_id,
    content: "ok",
    exit_code: 0,
    stdout: "ok",
    stderr: "",
  };
}

describe("L0S-T12", () => {
  test("execute returns string contract enforced", async () => {
    const reg = new HandsReplacementRegistry();

    // 合法 impl：返回完整 Observation（content 为 string）→ 通过。
    const valid: HandsImpl = {
      name: "bash",
      version: "v2",
      impl: ok,
      signoffs: [
        { change: "replace bash", signature: "ssh-sig", signer: "security@team" },
      ],
    };
    expect(() => reg.assertContract(valid)).not.toThrow();

    // 破坏契约：content 非 string → throw。
    const brokenContent: HandsImpl = {
      ...valid,
      impl: async (a) => ({ ...ok(a), content: 42 as unknown as string }),
    };
    expect(() => reg.assertContract(brokenContent)).toThrow();

    // 破坏契约：impl 不是函数 → throw。
    const notFn: HandsImpl = {
      ...valid,
      impl: "not-a-function" as unknown as HandsImpl["impl"],
    };
    expect(() => reg.assertContract(notFn)).toThrow();
  });
});
