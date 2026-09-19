// CE-T05: LLM-judge 去偏配置 — position swap A/B + length-controlled + CoT + combined-budget + σ 跟踪 + judge model pool
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T05）的 Given/When/Then 全部场景：
//   1. 两个 variant A/B + 去偏配置 → scoreA/scoreB 来自 swap A/B 两次评分 + sigma 落报告（正常路径）
//   2. sigma > 声称 gap → consistent=false（判 noise，不入选）（边界）
//   3. judge 与 variant/agent 同模型族 → 该 judge 被剔除（错误路径，self-preference）
//   4. calibrateAgainstL0 用 CE-T02 exit code 校准 judge（铁律：有 L0 就不上 L1）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  runDebiasedJudge,
  calibrateAgainstL0,
  type Variant,
  type DebiasConfig,
  type JudgeResult,
} from "@harness/canary-eval";
import type { VerifierRun } from "@harness/canary-eval";

function mkVariant(sha: string, module = "l1-config"): Variant {
  return { sha, module, config: { prompt: `cfg-${sha}` } } as unknown as Variant;
}

function cfg(overrides?: Partial<DebiasConfig>): DebiasConfig {
  return {
    positionSwap: true,
    lengthControlled: true,
    cot: true,
    combinedBudget: 5,
    sigmaThreshold: 0.054,
    modelPool: ["openai/gpt-4o", "google/gemini-1.5-pro"],
    ...overrides,
  } as DebiasConfig;
}

describe("CE-T05", () => {
  it("should swap A/B and report sigma", async () => {
    const a = mkVariant("aaa");
    const b = mkVariant("bbb");
    // 注入 judge：记录调用顺序（A-first / B-first）以验证 swap
    const calls: string[] = [];
    const judge = async (v: Variant, position: "A" | "B"): Promise<number> => {
      calls.push(`${position}:${v.sha}`);
      return position === "A" ? 0.8 : 0.6; // 不同位置给不同分 → swap 检测 position bias
    };

    const result: JudgeResult = await runDebiasedJudge(a, b, cfg(), { judge });

    expect(typeof result.scoreA).toBe("number");
    expect(typeof result.scoreB).toBe("number");
    expect(typeof result.sigma).toBe("number");
    expect(result.sigma).toBeGreaterThanOrEqual(0);
    // swap A/B 两次：A 位置与 B 位置都被调用
    expect(calls.some((c) => c.startsWith("A:"))).toBe(true);
    expect(calls.some((c) => c.startsWith("B:"))).toBe(true);
  });

  it("should mark inconsistent when sigma > gap", async () => {
    const a = mkVariant("aaa");
    const b = mkVariant("bbb");
    // 确定性 judge：位置决定分数（A=0.9 / B=0.1），与 variant 无关 →
    // swap A/B 后 scoreA≈scoreB（gap≈0），但跨位置 sigma≈0.4 远超声称 gap。
    // 用 Math.random 的非确定性 judge + 条件断言会让空壳实现（sigma=0, consistent=true）
    // 蒙混过关；此处改为无条件断言锁死噪声判定语义。
    const judge = async (_v: Variant, pos: "A" | "B"): Promise<number> => {
      return pos === "A" ? 0.9 : 0.1;
    };

    const result = await runDebiasedJudge(a, b, cfg(), { judge });

    // 声称 gap = |scoreA - scoreB| ≈ 0；sigma（跨位置抖动）远大于 gap → 判 noise。
    const claimedGap = Math.abs(result.scoreA - result.scoreB);
    expect(result.sigma).toBeGreaterThan(claimedGap);
    // 无条件断言：sigma > gap 时 consistent 必须为 false（不入选）
    expect(result.consistent).toBe(false);
  });

  it("should drop same-family judge from pool", async () => {
    const a = mkVariant("aaa");
    const b = mkVariant("bbb");
    let judgeInvoked = false;
    const judge = async (): Promise<number> => {
      judgeInvoked = true;
      return 0.7;
    };

    // judge pool 全为同模型族 → 该 judge 被剔除，runDebiasedJudge 须拒绝（throw 或换池后无可用）
    await expect(
      runDebiasedJudge(
        a,
        b,
        cfg({ modelPool: ["anthropic/claude-3.5", "anthropic/claude-3"] }),
        { judge, agentModelFamily: "anthropic" },
      ),
    ).rejects.toThrow();
    expect(judgeInvoked).toBe(false);
  });

  it("should calibrate accuracy against L0 verdicts", () => {
    const judgeResults: JudgeResult[] = [
      { scoreA: 1, scoreB: 0, sigma: 0, consistent: true }, // judge 判 A 优
      { scoreA: 0, scoreB: 1, sigma: 0, consistent: true }, // judge 判 B 优
    ];
    // L0 verdict：第一个任务 A pass(exit 0) B fail；第二个 A fail B pass —— 与 judge 一致
    const l0Verdicts: VerifierRun[] = [
      { taskId: "t1", command: "", exitCode: 0, stdout: "", stderr: "", runId: "r1", contiguousRun: true },
      { taskId: "t2", command: "", exitCode: 1, stdout: "", stderr: "", runId: "r2", contiguousRun: true },
    ];

    const { accuracy } = calibrateAgainstL0(judgeResults, l0Verdicts);
    expect(typeof accuracy).toBe("number");
    expect(accuracy).toBeGreaterThanOrEqual(0);
    expect(accuracy).toBeLessThanOrEqual(1);
  });
});
