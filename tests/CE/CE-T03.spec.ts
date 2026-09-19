// CE-T03: AgentLens Lucky-Pass 过滤集成 — 拒绝盲目重试/regression 循环过的 trajectory
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T03）的 Given/When/Then 全部场景：
//   1. pass trajectory 含 ≥3 次连续同工具同输入重试后偶发成功 → isLuckyPass=true, reason='blind_retry_loop'（正常路径）
//   2. pass trajectory 无重试循环、单次正确 → isLuckyPass=false, reason='solid'（边界，solid）
//   3. trajectory 缺 toolCalls → isLuckyPass=false, reason='solid'（宁可放过不误判）（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  detectLuckyPass,
  filterAndTag,
  type Trajectory,
  type LuckyPassVerdict,
} from "@harness/canary-eval";

function call(tool: string, input: unknown): Trajectory["toolCalls"][number] {
  return { tool, input, result: "ok" } as Trajectory["toolCalls"][number];
}

describe("CE-T03", () => {
  it("should flag blind retry loop lucky pass", () => {
    // ≥3 次连续同工具同输入重试后偶发成功
    const t: Trajectory = {
      sessionId: "s1",
      toolCalls: [
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }), // 第 4 次同输入，触发 blind_retry_loop（连续 ≥3）
      ],
      outcome: "pass",
    } as Trajectory;

    const verdict: LuckyPassVerdict = detectLuckyPass(t);
    expect(verdict.isLuckyPass).toBe(true);
    expect(verdict.reason).toBe("blind_retry_loop");
    expect(verdict.retryLoopCount).toBeGreaterThanOrEqual(3);
  });

  it("should pass solid trajectory", () => {
    // 无重试循环、单次正确解决
    const t: Trajectory = {
      sessionId: "s2",
      toolCalls: [
        call("read", { file: "a.py" }),
        call("edit", { file: "a.py" }),
        call("run", { cmd: "pytest" }),
      ],
      outcome: "pass",
    } as Trajectory;

    const verdict = detectLuckyPass(t);
    expect(verdict.isLuckyPass).toBe(false);
    expect(verdict.reason).toBe("solid");
    expect(verdict.retryLoopCount).toBe(0);
  });

  it("should handle missing toolCalls gracefully", () => {
    // trajectory 缺 toolCalls → 宁可放过不误判，但记告警
    const t = { sessionId: "s3", outcome: "pass" } as unknown as Trajectory;

    const verdict = detectLuckyPass(t);
    expect(verdict.isLuckyPass).toBe(false);
    expect(verdict.reason).toBe("solid");
  });

  it("filterAndTag tags each entry with luckyPass and substrateSha", () => {
    const solid: Trajectory = {
      sessionId: "s2",
      toolCalls: [call("edit", { file: "a.py" })],
      outcome: "pass",
    } as Trajectory;
    const lucky: Trajectory = {
      sessionId: "s1",
      toolCalls: [
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }),
        call("edit", { file: "a.py" }),
      ],
      outcome: "pass",
    } as Trajectory;

    const tagged = filterAndTag([solid, lucky], { substrateSha: "sha-xyz" });

    // 每条 entry 打上 luckyPass 标 + substrateSha 透传（defense-in-depth：L3 入口再复检）
    expect(tagged.length).toBe(2);
    for (const entry of tagged as Array<Record<string, unknown>>) {
      expect(entry).toHaveProperty("luckyPass");
      expect(entry).toHaveProperty("substrateSha");
      expect(entry["substrateSha"]).toBe("sha-xyz");
    }
    // lucky 的 entry 标 true，solid 标 false
    const luckyEntry = tagged.find((e) => (e as { sessionId: string }).sessionId === "s1");
    const solidEntry = tagged.find((e) => (e as { sessionId: string }).sessionId === "s2");
    expect((luckyEntry as { luckyPass: boolean }).luckyPass).toBe(true);
    expect((solidEntry as { luckyPass: boolean }).luckyPass).toBe(false);
  });
});
