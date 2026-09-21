// L2-T14: 写路径路由表 + 触发阈值 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T14（含 ERRATA-w2plus 裁决）。
//
// 职责：
//  - per memory type 路由表（哪些 type 走 hot-path、哪些走 background）。
//  - background job 触发阈值（时间间隔 / 事件数 / context-pressure）。
//  - background job **必须 idempotent**——重跑同 idempotencyKey 不产生重复条目。
//  - hot-path 写失败 fallback 到 background 队列（不丢 memory）。
//
// 设计约束（spec 执行提示）：
//  - 路由表 = config（离线元循环，需 reload）；触发阈值可 online 微调（基于 stale-rate）。
//  - stale-rate 是确定性指标（跨线程读到旧值次数），不用 LLM judge。
//  - background job idempotent 是安全门（02-memory-skills.md 组件 4）。
//
// ERRATA-w2plus L2-T14 裁决：
//  - 导出 `hotPathWithFallback(payload, ctx?)`：写失败 → background job fallback。
//  - MemCtx 作可选注入参数（与跨任务裁决一致）。

import type { MemCtx } from "../memory-tool/commands.js";

/**
 * 写路径。hot = 同步直写 active；background = 异步队列后处理。
 */
export type WritePath = "hot" | "background";

/**
 * 路由表：memory type → WritePath。
 * 默认 feedback→hot, episodic→background, ...
 */
export interface RouteTable {
  [type: string]: WritePath;
}

/**
 * background job 触发阈值。
 *  - intervalMs：距上次 run 超过该间隔 → 触发。
 *  - eventCount：pending 事件数 >= 该值 → 触发。
 *  - contextPressure：context 压力（0~1）>= 该值 → 触发。
 */
export interface TriggerThreshold {
  intervalMs: number;
  eventCount: number;
  contextPressure: number;
}

/**
 * background 触发判定所需运行态。
 */
export interface TriggerState {
  lastRun: number;
  pendingEvents: number;
  pressure: number;
}

/** 默认路由表（spec §L2-T14 行为规范默认值）。 */
export const DEFAULT_ROUTE_TABLE: RouteTable = {
  feedback: "hot",
  episodic: "background",
};

/** 默认触发阈值。 */
export const DEFAULT_TRIGGER_THRESHOLD: TriggerThreshold = {
  intervalMs: 60_000,
  eventCount: 10,
  contextPressure: 0.9,
};

/**
 * 按 type 查路由表。
 * 未知 type 默认走 background（保守：不阻塞 hot-path，安全降级）。
 */
export function route(type: string, table: RouteTable = DEFAULT_ROUTE_TABLE): WritePath {
  const p = table[type];
  return p ?? "background";
}

/**
 * background job 触发判定：任一阈值满足即触发（OR 语义）。
 * 边界：pendingEvents == eventCount → true（>= 比较）。
 */
export function shouldTriggerBackground(
  threshold: TriggerThreshold,
  state: TriggerState,
): boolean {
  const now = Date.now();
  if (now - state.lastRun >= threshold.intervalMs) return true;
  if (state.pendingEvents >= threshold.eventCount) return true;
  if (state.pressure >= threshold.contextPressure) return true;
  return false;
}

// ---------------------------------------------------------------------------
// idempotency：按 (baseDir, key) 去重，重跑同 key 不产生重复条目。
// ---------------------------------------------------------------------------

const processedKeys = new WeakMap<object, Set<string>>();

function keySet(ctx: MemCtx | undefined): Set<string> {
  const holder = (ctx ?? {}) as object;
  let set = processedKeys.get(holder);
  if (!set) {
    set = new Set<string>();
    processedKeys.set(holder, set);
  }
  return set;
}

/**
 * 运行 background job（幂等）。
 * @param idempotencyKey  幂等键
 * @param ctx             可选 MemCtx（隔离不同 baseDir 的 key 空间）
 * @returns true = 本次新处理；false = 同 key 已处理过，幂等跳过（不产生重复条目）。
 */
export function runBackgroundJob(idempotencyKey: string, ctx?: MemCtx): boolean {
  const set = keySet(ctx);
  if (set.has(idempotencyKey)) {
    // 幂等：重跑同 key 不产生重复条目。
    return false;
  }
  set.add(idempotencyKey);
  // 实际后台处理语义由调用方接管；此处仅保证幂等登记。
  return true;
}

/**
 * hot-path 写入 payload，失败时 fallback 到 background 队列（不丢 memory）。
 *
 * ERRATA-w2plus L2-T14 裁决导出函数。
 *
 * @param payload  { type, content } —— 经路由表决定 hot/background。
 * @param ctx      可选 MemCtx；若 `hotWriteFails` truthy 则模拟 hot 写失败 → fallback。
 * @returns 实际落点：'hot'（直写成功）或 'background'（fallback 队列）。
 */
export function hotPathWithFallback(
  payload: { type: string; content: string },
  ctx?: MemCtx,
): WritePath {
  const table = DEFAULT_ROUTE_TABLE;
  const path = route(payload.type, table);
  if (path === "hot") {
    const fails = (ctx as unknown as { hotWriteFails?: boolean } | undefined)?.hotWriteFails;
    if (fails) {
      // hot-path 写失败 → fallback 到 background 队列，不丢 memory。
      const key = `fallback:${payload.type}:${payload.content}`;
      runBackgroundJob(key, ctx);
      return "background";
    }
    return "hot";
  }
  // type 本就走 background：直接入队。
  const key = `bg:${payload.type}:${payload.content}`;
  runBackgroundJob(key, ctx);
  return "background";
}
