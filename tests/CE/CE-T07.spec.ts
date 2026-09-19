// CE-T07: fresh-evidence 终审门 hook — select 前 abort 若无 exit-code 证据
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T07）的 Given/When/Then 全部场景：
//   1. variant 有 ≥1 条 verifications 且每条有 exitCode → assertFreshEvidence 放行（正常路径）
//   2. verifications=[] 或 hasExitCodeEvidence=false → throw AbortSelectError（边界）
//   3. evidence 仅含 prose "应该过了" 无 exitCode → throw AbortSelectError（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  assertFreshEvidence,
  AbortSelectError,
  type FreshEvidence,
  type VerifierRun,
} from "@harness/canary-eval";

function mkRun(exitCode: number): VerifierRun {
  return {
    taskId: "CE-TASK-0001",
    command: "pytest -x tests/",
    exitCode,
    stdout: "...",
    stderr: "",
    runId: "r-" + exitCode,
    contiguousRun: true,
  };
}

describe("CE-T07", () => {
  it("should pass when exit-code evidence exists", () => {
    const e: FreshEvidence = {
      variantSha: "variant-sha",
      verifications: [mkRun(0)],
      hasExitCodeEvidence: true,
    };

    expect(() => assertFreshEvidence(e)).not.toThrow();
  });

  it("should abort when no verifications", () => {
    const e: FreshEvidence = {
      variantSha: "variant-sha",
      verifications: [], // 空 → 无机械证据
      hasExitCodeEvidence: false,
    };

    expect(() => assertFreshEvidence(e)).toThrow(AbortSelectError);
  });

  it("should abort on prose-only evidence", () => {
    // 仅 prose "应该过了"，无 exitCode（错误路径）
    const proseRun = {
      taskId: "CE-TASK-0001",
      command: "",
      stdout: "应该过了",
      stderr: "",
      runId: "prose",
      contiguousRun: true,
      // exitCode 缺失
    } as unknown as VerifierRun;

    const e: FreshEvidence = {
      variantSha: "variant-sha",
      verifications: [proseRun],
      hasExitCodeEvidence: false,
    };

    expect(() => assertFreshEvidence(e)).toThrow(AbortSelectError);
  });
});
