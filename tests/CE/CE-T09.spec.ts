// CE-T09: canary Context Saturation Gap Δ 度量器（MAG perf − brute-force full-context baseline）
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T09）的 Given/When/Then 全部场景：
//   1. magPerf=0.6, brute=0.4 → delta=0.2, hasDiscrimination=true, anomaly=false（正常路径）
//   2. magPerf=0.42, brute=0.40 → delta=0.02 < 0.05, hasDiscrimination=false, anomaly=false（边界）
//   3. magPerf=0.3, brute=0.4 → mag<brute, hasDiscrimination=false, anomaly=true（错误路径，异常）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  computeSaturationGap,
  DISCRIMINATION_THRESHOLD,
  type SaturationGap,
} from "@harness/canary-eval";

describe("CE-T09", () => {
  it("should report positive delta with discrimination", () => {
    // static-core 阈值与 CE-T08 McNemar n≈30 噪声带对齐（5pp）
    expect(DISCRIMINATION_THRESHOLD).toBe(0.05);

    const result: SaturationGap = computeSaturationGap(0.6, 0.4);
    expect(result.magPerf).toBe(0.6);
    expect(result.bruteForceFullContext).toBe(0.4);
    expect(result.delta).toBeCloseTo(0.2, 10);
    expect(result.hasDiscrimination).toBe(true); // delta >= 0.05 且 mag >= brute
    expect(result.anomaly).toBe(false);
  });

  it("should flag no discrimination when delta below threshold", () => {
    const result = computeSaturationGap(0.42, 0.4);
    expect(result.delta).toBeCloseTo(0.02, 10);
    expect(result.hasDiscrimination).toBe(false); // delta < 0.05，canary 失效信号
    expect(result.anomaly).toBe(false);
  });

  it("should warn when mag<brute", () => {
    const result = computeSaturationGap(0.3, 0.4);
    expect(result.hasDiscrimination).toBe(false);
    expect(result.anomaly).toBe(true); // mag < brute → 数据异常，告警
    expect(result.delta).toBeLessThan(0);
  });
});
