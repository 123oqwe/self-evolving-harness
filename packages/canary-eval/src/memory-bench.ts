// CE-T10: MemoryAgentBench 四能力 eval harness + Context Saturation Gap [V1]
//
// 背景：记忆库须四能力评测（accurate retrieval / test-time learning / long-range /
// selective forgetting，E14/R15），selective forgetting 是最弱竞争力（multi-hop ≤28%）。
//
// ERRATA-w2plus 裁决（CE-T10）：
//   - [补定义] `MemoryToolHandle` 类型如上；`@harness/canary-eval` 须导出。
//     `MemoryBenchResult` 加可选 `weakness?: string` 字段，selective forgetting <=0.28
//     → `weakness='selective_forgetting'`。
//   - [补定义] `runMemoryAgentBench` 裁定为双参 `(memoryTool, opts?)`；
//     `opts.magPerf`/`opts.bruteForceFullContext` 注入 `SaturationGap` 计算。
//
// 规则（spec §CE-T10 GREEN）：
//   - 四能力分数 = passed / total ∈ [0,1]；不可用能力跳过不产生伪分数（throw 透传）。
//   - selectiveForgetting <= 0.28 → weakness='selective_forgetting'。
//   - saturationGap 复用 CE-T09 computeSaturationGap。
//   - memory tool 不可用（null/undefined）→ throw，不产生伪分数。

import { computeSaturationGap, type SaturationGap } from "./saturation-gap.js";

// MemoryToolHandle：L2 memory tool 的最小消费契约（L2 包占位，CE 侧定义）。
// ERRATA-w2plus CE-21：须由 @harness/canary-eval 导出。
export interface MemoryToolHandle {
  retrieve(query: string): Promise<unknown>;
  forget(key: string): Promise<void>;
  runAccurateRetrieval(): Promise<{ passed: number; total: number }>;
  runTestTimeLearning(): Promise<{ passed: number; total: number }>;
  runLongRange(): Promise<{ passed: number; total: number }>;
  runSelectiveForgetting(): Promise<{ passed: number; total: number }>;
}

export interface MemoryBenchResult {
  accurateRetrieval: number;
  testTimeLearning: number;
  longRange: number;
  selectiveForgetting: number;
  saturationGap: SaturationGap;
  weakness?: string; // 'selective_forgetting' 等，selective forgetting <=0.28 时置
}

// selective forgetting 弱阈值：multi-hop ≤28%（E14/R15）。
const SELECTIVE_FORGETTING_WEAK_THRESHOLD = 0.28;

export interface MemoryBenchOptions {
  magPerf?: number;
  bruteForceFullContext?: number;
}

// 把能力方法返回的 { passed, total } 汇总为 [0,1] 分数。
// total<=0 时分数为 0（不产生 NaN 伪分数）。
function ratio(r: { passed: number; total: number }): number {
  if (!r || r.total <= 0) return 0;
  return r.passed / r.total;
}

// runMemoryAgentBench：四能力 case runner。
// ERRATA-w2plus CE-22：双参 (memoryTool, opts?)。
export async function runMemoryAgentBench(
  memoryTool: MemoryToolHandle,
  opts?: MemoryBenchOptions,
): Promise<MemoryBenchResult> {
  // memory tool 不可用 → throw + 不产生伪分数（错误路径）。
  if (memoryTool == null) {
    throw new Error("memory tool unavailable: cannot run MemoryAgentBench");
  }

  // 四能力逐个跑；任一能力 throw → 透传，跳过该能力不产生伪分数。
  const accurateR = await memoryTool.runAccurateRetrieval();
  const testTimeR = await memoryTool.runTestTimeLearning();
  const longRangeR = await memoryTool.runLongRange();
  const selectiveR = await memoryTool.runSelectiveForgetting();

  const accurateRetrieval = ratio(accurateR);
  const testTimeLearning = ratio(testTimeR);
  const longRange = ratio(longRangeR);
  const selectiveForgetting = ratio(selectiveR);

  // saturationGap 复用 CE-T09；opts 缺省时 mag/brute 按 0 处理。
  const magPerf = opts?.magPerf ?? 0;
  const bruteForceFullContext = opts?.bruteForceFullContext ?? 0;
  const saturationGap = computeSaturationGap(magPerf, bruteForceFullContext);

  const result: MemoryBenchResult = {
    accurateRetrieval,
    testTimeLearning,
    longRange,
    selectiveForgetting,
    saturationGap,
  };

  // selective forgetting 得分 <=0.28 → 标 weakness='selective_forgetting'（R15 风险信号）。
  if (selectiveForgetting <= SELECTIVE_FORGETTING_WEAK_THRESHOLD) {
    result.weakness = "selective_forgetting";
  }

  return result;
}
