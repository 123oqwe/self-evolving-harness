// CE-T10: MemoryAgentBench 四能力 eval harness + Context Saturation Gap
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T10）的 Given/When/Then 全部场景：
//   1. L2 memory tool → 四能力指标落报告 + saturationGap 复用 CE-T09（正常路径）
//   2. selective forgetting 得分 <=0.28 → 标 weakness='selective_forgetting'（边界，multi-hop 弱）
//   3. memory tool 不可用 → throw + 跳过该能力不产生伪分数（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  runMemoryAgentBench,
  type MemoryBenchResult,
  type MemoryToolHandle,
  type SaturationGap,
} from "@harness/canary-eval";

// 假 memory tool：每能力方法返回 pass/fail 计数 → runMemoryAgentBench 汇总为 [0,1] 分数
function fakeTool(opts?: {
  accurate?: number;
  testTime?: number;
  longRange?: number;
  selectiveForgetting?: number;
}): MemoryToolHandle {
  return {
    runAccurateRetrieval: async () => ({ passed: opts?.accurate ?? 8, total: 10 }),
    runTestTimeLearning: async () => ({ passed: opts?.testTime ?? 7, total: 10 }),
    runLongRange: async () => ({ passed: opts?.longRange ?? 6, total: 10 }),
    runSelectiveForgetting: async () => ({
      passed: opts?.selectiveForgetting ?? 2, // <=0.28 默认弱
      total: 10,
    }),
    retrieve: async () => "mem",
    forget: async () => true,
  } as unknown as MemoryToolHandle;
}

describe("CE-T10", () => {
  it("should report four competencies and saturation gap", async () => {
    const result: MemoryBenchResult = await runMemoryAgentBench(fakeTool(), {
      magPerf: 0.6,
      bruteForceFullContext: 0.4,
    });

    expect(typeof result.accurateRetrieval).toBe("number");
    expect(typeof result.testTimeLearning).toBe("number");
    expect(typeof result.longRange).toBe("number");
    expect(typeof result.selectiveForgetting).toBe("number");
    for (const v of [
      result.accurateRetrieval,
      result.testTimeLearning,
      result.longRange,
      result.selectiveForgetting,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // saturationGap 复用 CE-T09
    const gap = result.saturationGap as SaturationGap;
    expect(typeof gap.delta).toBe("number");
    expect(typeof gap.hasDiscrimination).toBe("boolean");
  });

  it("should flag weak selective forgetting", async () => {
    // selective forgetting 得分 <=0.28（multi-hop ≤28%）→ weakness 标记
    const result = await runMemoryAgentBench(
      fakeTool({ selectiveForgetting: 2 }), // 0.2 <= 0.28
      { magPerf: 0.5, bruteForceFullContext: 0.4 },
    );

    expect(result.selectiveForgetting).toBeLessThanOrEqual(0.28);
    expect(result.weakness).toBe("selective_forgetting");
  });

  it("should throw when memory tool unavailable", async () => {
    // memory tool 不可用 → throw + 不产生伪分数
    await expect(
      runMemoryAgentBench(null as unknown as MemoryToolHandle, {
        magPerf: 0.5,
        bruteForceFullContext: 0.4,
      }),
    ).rejects.toThrow();
  });
});
