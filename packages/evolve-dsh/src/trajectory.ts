// PLG-T11: dsh 事件溯源 JSONL → L3 Trajectory[] 解析。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
//
// 复用铁律（§0.2）：dsh 事件流与 L0C-T07b session-log 同源，事件形状与 TL-T01
// transcript 契约高度同构 → 诊断提取**优先复用** `@harness/adapters` 的
// `extractDiagnosis`；未命中（私有字段名不同构）再走 `extractDshDiagnosis` 私有
// 兜底（容错 `error`/`failed`/`is_error`/`status==='error'`）。不硬编码单一 schema。

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";
import { extractDiagnosis } from "@harness/adapters";

/** dsh 事件溯源 JSONL 单事件最小形状（append-only 事件流，与 L0C-T07b 同源设计）。 */
export interface DshEvent {
  readonly type?: string;
  readonly timestamp?: string;
  /** 容错多字段名：sessionId / session_id / id。 */
  readonly sessionId?: string;
  readonly session_id?: string;
  readonly id?: string;
  readonly payload?: unknown;
}

/** 从事件对象容错提取 sessionId（多字段名）。 */
export function getSessionId(evt: DshEvent): string | null {
  const raw = (evt as Record<string, unknown>);
  const cand = raw.sessionId ?? raw.session_id ?? raw.id;
  if (typeof cand === "string" && cand.length > 0) return cand;
  return null;
}

/**
 * 递归收集目录下所有 *.jsonl 文件路径。
 */
function collectJsonlFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectJsonlFiles(abs, acc);
    } else if (abs.endsWith(".jsonl")) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * 读单个 JSONL 文件 → DshEvent[]（逐行 JSON.parse 容错，跳过非法行不崩）。
 */
function readEventsFromFile(filePath: string): DshEvent[] {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: DshEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const obj = JSON.parse(trimmed) as DshEvent;
      out.push(obj);
    } catch {
      // 非法 JSONL 行 → 跳过（warn 语义，不崩，合法行仍参与）
    }
  }
  return out;
}

/**
 * 按 sessionId 分组事件流。
 */
export function groupBySession(events: DshEvent[]): Map<string, DshEvent[]> {
  const groups = new Map<string, DshEvent[]>();
  for (const evt of events) {
    const sid = getSessionId(evt);
    if (sid === null) continue;
    let bucket = groups.get(sid);
    if (!bucket) {
      bucket = [];
      groups.set(sid, bucket);
    }
    bucket.push(evt);
  }
  return groups;
}

/**
 * 从 dsh 私有 error 字段提取诊断文本（extractDiagnosis 未命中时的兜底）。
 * 容错多种 error 信号字段名，不硬编码单一字段。
 */
export function extractDshDiagnosis(events: DshEvent[]): string | null {
  for (const evt of events) {
    const p = (evt?.payload ?? {}) as Record<string, unknown>;
    const isError =
      evt.type === "error" ||
      p.is_error === true ||
      p.failed === true ||
      p.status === "error" ||
      (typeof p.error === "string" && p.error.length > 0);
    if (!isError) continue;
    if (typeof p.error === "string" && p.error.trim().length > 0) {
      return p.error;
    }
    if (typeof p.content === "string" && p.content.trim().length > 0) {
      return p.content;
    }
    const serialized = JSON.stringify(p);
    if (serialized && serialized !== "{}") return serialized;
  }
  return null;
}

/**
 * 单 session 事件流 → Trajectory（诊断提取优先复用 extractDiagnosis，兜底私有字段）。
 * 无失败信号 → 返回 null（调用方跳过非失败 session）。
 */
export function eventStreamToTrajectory(
  sessionId: string,
  events: DshEvent[],
  substrateSha = "",
): Trajectory | null {
  // 优先复用 extractDiagnosis（TL-T01 同构形状）
  const diag = extractDiagnosis(events);
  if (diag !== null) {
    return {
      id: sessionId,
      sessionId,
      substrateSha,
      source: "real",
      failed: true,
      diagnosis: diag,
      raw: events,
    };
  }
  // 兜底：dsh 私有 error 字段
  const fallback = extractDshDiagnosis(events);
  if (fallback !== null) {
    return {
      id: sessionId,
      sessionId,
      substrateSha,
      source: "real",
      failed: true,
      diagnosis: fallback,
      raw: events,
    };
  }
  return null;
}

/**
 * 扫 <dshHome>/ 递归 *.jsonl → 按 sessionId 分组事件流 → Trajectory[]。
 * - 非法 JSONL 行跳过不崩
 * - 无 error 信号的 session 不入结果
 * - dshHome 不存在 → 返回 []
 */
export function readDshTrajectories(
  dshHome: string,
  substrateSha: string,
): Trajectory[] {
  const files = collectJsonlFiles(dshHome);
  if (files.length === 0) return [];
  const allEvents: DshEvent[] = [];
  for (const f of files) {
    allEvents.push(...readEventsFromFile(f));
  }
  const groups = groupBySession(allEvents);
  const out: Trajectory[] = [];
  for (const [sid, evts] of groups) {
    const t = eventStreamToTrajectory(sid, evts, substrateSha);
    if (t !== null) out.push(t);
  }
  return out;
}
