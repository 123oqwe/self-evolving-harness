// CE-T09: canary Context Saturation Gap Δ 度量器
// （MAG perf − brute-force full-context baseline）。
//
// 背景：canary 须有区分力（G7，Δ = MAG perf − brute-force full-context baseline，
// Δ>>0 才有区分力，PRD §9.1）。
//
// ERRATA-w2plus 裁决：CE-T09 无跨任务级裁决（grep ERRATA-w01/ERRATA-w2plus 无 CE-T09），
// 按原 spec 接口签名一字不差实现。
//
// 规则（spec §CE-T09 GREEN）：
//   hasDiscrimination = delta >= DISCRIMINATION_THRESHOLD && mag >= brute
//   anomaly = mag < brute
//
// 阈值 5pp（0.05）与 CE-T08 McNemar n≈30 噪声带对齐。

// 区分力阈值（static-core，不进化）：delta >= DISCRIMINATION_THRESHOLD 才算有区分力。
export const DISCRIMINATION_THRESHOLD = 0.05;

export interface SaturationGap {
  magPerf: number; // MemoryAgentGated perf
  bruteForceFullContext: number;
  delta: number; // = mag - brute
  hasDiscrimination: boolean; // delta >= DISCRIMINATION_THRESHOLD 且 mag >= brute
  anomaly: boolean; // mag < brute → 数据异常，告警
}

export function computeSaturationGap(mag: number, brute: number): SaturationGap {
  const delta = mag - brute;
  const hasDiscrimination = delta >= DISCRIMINATION_THRESHOLD && mag >= brute;
  const anomaly = mag < brute;
  return {
    magPerf: mag,
    bruteForceFullContext: brute,
    delta,
    hasDiscrimination,
    anomaly,
  };
}
