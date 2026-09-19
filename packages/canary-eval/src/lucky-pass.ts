// CE-T03: AgentLens Lucky-Pass 过滤集成 — 拒绝盲目重试/regression 循环过的 trajectory。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T03 + ERRATA-w2plus 裁决（CE-10/CE-11）：
// - `detectLuckyPass(t)`：检测单条 trajectory 是否为 lucky pass。
//   * blind_retry_loop：≥3 次连续同工具同输入重试后偶发成功。
//   * regression_loop：非连续的折返循环（A B A B）。
//   * solid：无循环、单次正确解决（宁可放过不误判）。
//   * ideal：无循环且 pass 且 toolCalls 非空且无任何重试指纹重复。
// - `filterAndTag(t[], ctx)`：ERRATA-w2plus CE-10 裁决为**保留全部 entry + 打标**
//   （不剔除 luckyPass entry）：`tagged.length === input.length`，每条带
//   `luckyPass` + `substrateSha`。L3-T03 入口再复检 luckyPass 做 defense-in-depth。
// - 返回类型 `import('@harness/l3-engine').Trajectory`（CE-11：L3 须导出该类型，
//   形状 `{ id, sessionId, substrateSha, failed: true, diagnosis, luckyPass?, raw? }`）。
//   CE raw `Trajectory`（CE-T01a 定义）与输出 L3 `Trajectory` 同名不同形状——以导入来源区分。
//
// 复用铁律：循环检测抽通用 `src/loop-detector.ts`（spec REFACTOR），供 TL-T06
// runaway-loop detector 复用。Lucky-Pass 仅过滤 trajectory 接受，不影响 verifier
// exit code 裁决（L0 仍是 ground truth）。

import type { Trajectory } from "./canary/types.js";
import type { Trajectory as L3Trajectory } from "@harness/l3-engine";
import {
  detectRetryLoops,
  detectRegressionLoops,
  DEFAULT_RETRY_THRESHOLD,
  DEFAULT_REGRESSION_THRESHOLD,
  type ToolCall,
} from "./loop-detector.js";

/**
 * Lucky-Pass 裁决结果。
 *
 * - `isLuckyPass` true 表示该 trajectory 为盲目重试/回归循环过的偶发成功，不可进
 *   L3 generate 喂养集（L3-T03 入口再复检做 defense-in-depth）。
 * - `reason` 给出判定类型；`retryLoopCount` 为命中阈值的最长连续重试段长度
 *   （无循环时为 0）。
 */
export interface LuckyPassVerdict {
  isLuckyPass: boolean;
  reason: "blind_retry_loop" | "regression_loop" | "solid" | "ideal";
  retryLoopCount: number;
}

/** 从 raw Trajectory 提取归一化 toolCalls（缺省视为空）。 */
function toToolCalls(t: Trajectory): ToolCall[] {
  if (!Array.isArray(t.toolCalls)) return [];
  // 仅取 {tool, input, result} 字段；result 缺省置空串以维持 ToolCall 形状。
  return t.toolCalls.map((c) => ({
    tool: c.tool,
    input: c.input,
    result: c.result ?? "",
  }));
}

/**
 * 检测单条 trajectory 是否为 Lucky-Pass。
 *
 * 行为（spec §CE-T03 Given/When/Then）：
 * - pass trajectory 含 ≥3 次连续同工具同输入重试后偶发成功 → blind_retry_loop。
 * - pass trajectory 无重试循环、单次正确 → solid（边界）。
 * - trajectory 缺 toolCalls → solid（宁可放过不误判，但记告警由 reason 体现）。
 *
 * 检测阈值（连续同输入 ≥3）可配，后续可由 telemetry 调参。
 */
export function detectLuckyPass(
  t: Trajectory,
  opts?: { retryThreshold?: number; regressionThreshold?: number },
): LuckyPassVerdict {
  const calls = toToolCalls(t);

  // 错误路径：缺 toolCalls → 宁可放过不误判。
  if (calls.length === 0) {
    return { isLuckyPass: false, reason: "solid", retryLoopCount: 0 };
  }

  const retryThreshold = opts?.retryThreshold ?? DEFAULT_RETRY_THRESHOLD;
  const regressionThreshold =
    opts?.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD;

  const retry = detectRetryLoops(calls, retryThreshold);
  const regression = detectRegressionLoops(calls, regressionThreshold);

  // blind_retry_loop 优先（连续同输入 ≥3，最直接的盲目重试信号）。
  if (retry.loopSegments >= 1 && retry.maxConsecutiveRepeat >= retryThreshold) {
    return {
      isLuckyPass: true,
      reason: "blind_retry_loop",
      retryLoopCount: retry.maxConsecutiveRepeat,
    };
  }

  // regression_loop：非连续折返循环（A B A B）重复 ≥2 次。
  if (regression.cycleLength >= 2 && regression.repetitions >= regressionThreshold) {
    return {
      isLuckyPass: true,
      reason: "regression_loop",
      retryLoopCount: regression.repetitions,
    };
  }

  // 非盲目重试/非回归循环 → solid（spec §CE-T03 边界：宁可放过不误判；
  // 'ideal' 留作 union 成员但本任务不产出，保持判定语义稳定可测）。
  return { isLuckyPass: false, reason: "solid", retryLoopCount: 0 };
}

/**
 * 过滤+打标：保留全部 entry + 打 luckyPass 标 + 透传 substrateSha。
 *
 * ERRATA-w2plus CE-10 裁决：`filterAndTag` **保留全部 entry + 打标**（不剔除 luckyPass），
 * `tagged.length === input.length`。L3-T03 入口再复检 luckyPass 做 defense-in-depth。
 *
 * 输出形状 = L3-T03 `Trajectory`（CE-11）：
 *   `{ id, sessionId, substrateSha, failed: true, diagnosis, luckyPass?, raw? }`。
 * - `id` 取 raw `sessionId`（无独立 id 字段时以 sessionId 为准）。
 * - `substrateSha` 由 ctx 透传。
 * - `failed: true` 为 L3 feed 契约不变量（喂养集候选均标记为待复检）。
 * - `diagnosis` 为 Lucky-Pass 判定 reason（供 L3 入口审计）。
 * - `luckyPass` 布尔标记（solid/ideal=false，blind_retry_loop/regression_loop=true）。
 * - `raw` 保留原始 raw Trajectory 供 L3 复检取证。
 */
export function filterAndTag(
  trajectories: Trajectory[],
  ctx: { substrateSha: string },
): L3Trajectory[] {
  return trajectories.map((t) => {
    const verdict = detectLuckyPass(t);
    return {
      id: t.sessionId,
      sessionId: t.sessionId,
      substrateSha: ctx.substrateSha,
      failed: true as const,
      diagnosis: verdict.reason,
      luckyPass: verdict.isLuckyPass,
      raw: t,
    } satisfies L3Trajectory;
  });
}
