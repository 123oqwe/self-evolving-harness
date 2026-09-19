// CE-T02: 确定性验证器 harness — verify: 命令 exit-code 裁决 / 单次连续 run / 禁跨 run 合并
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T02）的 Given/When/Then 全部场景：
//   1. verify:'pytest -x tests/' + sandbox → exitCode 反映 FAIL-to-PASS（修复前非0、修复后0）+ stdout/stderr 单次连续 run（正常路径）
//   2. 两次 run stdout 拼进同一条 verdict → assertNoCrossRunMerge throw CrossRunMergeViolation（边界）
//   3. verify 命令超时/sandbox EPERM → exitCode 非0 + stderr 含信息，不产生 prose "应该过了"（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
// sandbox 适配器接口须与 L0S-T02 OssandboxBackend.runVerify(cmd, opts): VerifyResult 对齐。
//
import { describe, it, expect } from "vitest";
import {
  runVerify,
  assertNoCrossRunMerge,
  CrossRunMergeViolation,
  type VerifierRun,
  type CanaryTask,
  type SandboxHandle,
} from "@harness/canary-eval";
import type { VerifyResult } from "@harness/l0-sandbox";

function mkTask(verify = "pytest -x tests/"): CanaryTask {
  return {
    id: "CE-TASK-0001",
    repo: "org/repo-1",
    verify,
    expectedExit: 0,
    decontaminated: true,
    frozenInRelease: "abc123",
  } as CanaryTask;
}

// 假 sandbox：按 cmd 返回预设 VerifyResult（对齐 L0S-T02 VerifyResult 四字段形状）
function fakeSandbox(results: VerifyResult[]): SandboxHandle {
  let i = 0;
  return {
    runVerify: async (_cmd: string): Promise<VerifyResult> => {
      const r = results[i] ?? results[results.length - 1]!;
      i++;
      return r;
    },
  } as unknown as SandboxHandle;
}

describe("CE-T02", () => {
  it("should return exitCode 0 after FAIL-to-PASS fix", async () => {
    const task = mkTask();
    // 修复前：FAIL（exitCode=1）；修复后：PASS（exitCode=0）
    const sandbox = fakeSandbox([
      { exitCode: 1, stdout: "FAILED", stderr: "AssertionError", epermHits: [] },
      { exitCode: 0, stdout: "PASSED", stderr: "", epermHits: [] },
    ]);

    const failing = await runVerify(task, { sandbox });
    expect(failing.exitCode).toBe(1);
    expect(failing.stdout).toBe("FAILED");
    expect(failing.stderr).toContain("AssertionError");
    expect(failing.contiguousRun).toBe(true);
    expect(typeof failing.runId).toBe("string");
    expect(failing.runId.length).toBeGreaterThan(0);

    const passing = await runVerify(task, { sandbox });
    expect(passing.exitCode).toBe(0);
    expect(passing.stdout).toBe("PASSED");
    expect(passing.contiguousRun).toBe(true);
    // 每次调用 runId 须唯一
    expect(passing.runId).not.toBe(failing.runId);
  });

  it("should throw on cross-run stdout merge", () => {
    // 两次 run 复用同一 runId = 跨 run 合并证据
    const runs: VerifierRun[] = [
      {
        taskId: "CE-TASK-0001",
        command: "pytest -x tests/",
        exitCode: 0,
        stdout: "block-A",
        stderr: "",
        runId: "dup-run-id",
        contiguousRun: true,
      },
      {
        taskId: "CE-TASK-0001",
        command: "pytest -x tests/",
        exitCode: 0,
        stdout: "block-Ablock-B", // stdout 拼接进同一条 verdict
        stderr: "",
        runId: "dup-run-id",
        contiguousRun: true,
      },
    ];

    expect(() => assertNoCrossRunMerge(runs)).toThrow(CrossRunMergeViolation);
  });

  it("should never produce prose-only verdict on timeout", async () => {
    const task = mkTask();
    const sandbox = fakeSandbox([
      { exitCode: 124, stdout: "", stderr: "TIMEOUT after 30s", epermHits: [] },
    ]);

    const run = await runVerify(task, { sandbox });
    // 超时：exitCode 非0 + stderr 含 timeout 信息，无 prose "应该过了"
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toLowerCase()).toMatch(/timeout|eperm/);
    expect(run.contiguousRun).toBe(true);
  });
});
