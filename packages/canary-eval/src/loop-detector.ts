// CE-T03 REFACTOR: 通用循环检测器。
//
// 把 "连续同工具同输入重试" + "regression 循环（A B A B 折返）" 检测抽通用，
// 供 CE-T03 Lucky-Pass 与 TL-T06 runaway-loop detector 复用（spec REFACTOR 指令）。
//
// 输入为归一化后的 `{ tool: string; input: unknown; result: string }[]`，
// 不依赖任何 CE 业务类型，保持自包含。

/** 单条工具调用（归一化形状，与 CE-T01a `Trajectory.toolCalls[]` 元素同构）。 */
export interface ToolCall {
  tool: string;
  input: unknown;
  result: string;
}

/** 连续同 {tool,input} 重试的检测结果。 */
export interface RetryLoopResult {
  /** 最长一段连续同工具同输入的 run 长度（run 长度 = 重复次数含首条）。 */
  maxConsecutiveRepeat: number;
  /** 命中阈值的连续重试段个数（≥1 即视为 blind_retry_loop）。 */
  loopSegments: number;
}

/** regression 循环（折返，如 A B A B）的检测结果。 */
export interface RegressionLoopResult {
  /** 检测到的折返循环长度（构成循环的不同调用种类数）。 */
  cycleLength: number;
  /** 该循环重复出现的次数。 */
  repetitions: number;
}

/** 默认阈值：连续同工具同输入 ≥3 即 blind_retry_loop（spec CE-T03 行为规范）。 */
export const DEFAULT_RETRY_THRESHOLD = 3;

/** 默认阈值：折返循环重复 ≥2 次即 regression_loop。 */
export const DEFAULT_REGRESSION_THRESHOLD = 2;

/**
 * 稳定序列化 unknown input，用于等价比较（输入含对象时仍可判定同输入）。
 * 仅用于循环检测的等价判定，不做 schema 校验。
 */
export function serializeInput(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input ?? null);
  }
  try {
    return JSON.stringify(input, Object.keys(input as Record<string, unknown>).sort());
  } catch {
    return JSON.stringify(input);
  }
}

/** 计算单个调用的稳定指纹（tool + 序列化 input），result 不参与重试判定。 */
export function callFingerprint(call: ToolCall): string {
  return `${call.tool}::${serializeInput(call.input)}`;
}

/**
 * 检测连续同工具同输入重试段。
 *
 * run 长度 = 同指纹相邻连续出现的次数（含首条），即 N 条连续相同 = run 长度 N。
 * 当 run 长度 >= threshold 视为一段 blind_retry_loop。
 */
export function detectRetryLoops(
  calls: ToolCall[],
  threshold: number = DEFAULT_RETRY_THRESHOLD,
): RetryLoopResult {
  if (calls.length === 0) {
    return { maxConsecutiveRepeat: 0, loopSegments: 0 };
  }
  let maxConsecutiveRepeat = 1;
  let currentRun = 1;
  let loopSegments = 0;
  let prevFp: string | null = callFingerprint(calls[0]!);

  for (let i = 1; i < calls.length; i++) {
    const fp = callFingerprint(calls[i]!);
    if (fp === prevFp) {
      currentRun += 1;
    } else {
      if (currentRun >= threshold) loopSegments += 1;
      maxConsecutiveRepeat = Math.max(maxConsecutiveRepeat, currentRun);
      currentRun = 1;
      prevFp = fp;
    }
  }
  if (currentRun >= threshold) loopSegments += 1;
  maxConsecutiveRepeat = Math.max(maxConsecutiveRepeat, currentRun);

  return { maxConsecutiveRepeat, loopSegments };
}

/**
 * 检测 regression 循环（折返模式 A B A B ...）。
 *
 * 在最长 blind_retry_loop 段之外，若发现非连续的等价折返（同一指纹以固定周期重复
 * 出现且周期内含 ≥2 种不同调用、重复 ≥threshold 次），视为 regression_loop。
 */
export function detectRegressionLoops(
  calls: ToolCall[],
  threshold: number = DEFAULT_REGRESSION_THRESHOLD,
): RegressionLoopResult {
  if (calls.length < 4) {
    return { cycleLength: 0, repetitions: 0 };
  }
  const fps = calls.map(callFingerprint);
  let bestCycleLength = 0;
  let bestRepetitions = 0;

  // 尝试周期 2..floor(len/2)：寻找 A B A B 折返（周期内 ≥2 种不同调用）。
  const maxCycle = Math.floor(fps.length / 2);
  for (let cycle = 2; cycle <= maxCycle; cycle++) {
    // 周期内须 ≥2 种不同调用，否则退化为连续重试（已由 detectRetryLoops 覆盖）。
    const periodFps = fps.slice(0, cycle);
    if (new Set(periodFps).size < 2) continue;
    let reps = 1;
    for (let i = cycle; i < fps.length; i++) {
      if (fps[i] === fps[i - cycle]) {
        reps += 1;
      } else {
        break;
      }
    }
    if (reps >= threshold && reps > bestRepetitions) {
      bestCycleLength = cycle;
      bestRepetitions = reps;
    }
  }

  return { cycleLength: bestCycleLength, repetitions: bestRepetitions };
}
