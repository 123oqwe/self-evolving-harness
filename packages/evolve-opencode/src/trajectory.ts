// PLG-T03: OpenCode storage 三层 JSON → L3 Trajectory 解析。
//
// Spec: execution/plugin/TASKS.md §PLG-T03 (trajectory.ts).
// 复用铁律（§0.2）：`Trajectory` 形状从 `@harness/l3-engine` 导入；
// **不复用** `extractDiagnosis`——OpenCode part 结构私有（is_error/content
// 字段与 TL-T01 assistant 节点不同构），自写最小 `extractOpenCodeDiagnosis`。
//
// 调研为准（§0.6）：OpenCode 轨迹 = 文件系统 JSON 分层存储：
//   storage/session/info/<id>.json      会话元信息
//   storage/session/message/<sid>/<mid>.json
//   storage/session/part/<sid>/<mid>/<pid>.json
// pretty-printed 2 空格缩进（JSON.parse 容忍空白）。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";

/** OpenCode storage session info 最小形状（调研）。 */
export interface OpenCodeSessionInfo {
  readonly id: string;
  readonly title?: string;
  readonly directory?: string;
  readonly parentID?: string | null;
  readonly tokens?: { readonly input?: number; readonly output?: number };
  readonly time?: { readonly created?: number; readonly completed?: number };
}

interface OpenCodeMessage {
  readonly id: string;
  readonly sessionID: string;
  readonly role?: string;
  readonly parts?: readonly string[];
}

interface OpenCodePart {
  readonly id: string;
  readonly type?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

/** storage 根目录下的 session 子目录名（调研：storage/session/）。 */
const SESSION_SUBDIR = join("storage", "session");

/**
 * 扫 `dataDir/storage/session/info/*.json` → 重组 message/part → Trajectory[]。
 *
 * 行为（spec §PLG-T03 行为规范）：
 *  - dataDir 不存在 → 返回 []（不抛）。
 *  - info.json 非法 JSON → 跳过该 info（warn，不崩）。
 *  - message/part 缺失（孤儿 info）→ 跳过该 session（无 error 信号）。
 *  - 命中 error part（is_error===true）才入 Trajectory（非失败 session 跳过）。
 *  - substrateSha 透传存入 Trajectory（不过滤，由上游 CE-T03 / Lucky-Pass 守卫）。
 */
export function readOpenCodeTrajectories(
  dataDir: string,
  substrateSha: string,
): Trajectory[] {
  const sessionDir = join(dataDir, SESSION_SUBDIR);
  const infoDir = join(sessionDir, "info");
  if (!existsSync(infoDir)) return [];
  let infoFiles: string[] = [];
  try {
    infoFiles = readdirSync(infoDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  for (const file of infoFiles) {
    const infoAbs = join(infoDir, file);
    let infoText: string;
    try {
      infoText = readFileSync(infoAbs, "utf8");
    } catch {
      continue;
    }
    let info: OpenCodeSessionInfo;
    try {
      info = JSON.parse(infoText) as OpenCodeSessionInfo;
    } catch {
      // 非法 info.json → 跳过该 info（spec 错误路径：不崩）。
      // eslint-disable-next-line no-console
      console.warn(`[opencode-adapter] skipping malformed info.json: ${file}`);
      continue;
    }
    const sid = info.id;
    if (!sid) continue;
    const events = reassembleSession(sessionDir, sid);
    if (events.length === 0) {
      // 孤儿 info（无 message/part）→ 跳过。
      continue;
    }
    const diag = extractOpenCodeDiagnosis(events);
    if (diag === null) {
      // 无 error 信号 → 非失败轨迹，跳过。
      continue;
    }
    out.push({
      id: sid,
      sessionId: sid,
      substrateSha,
      source: "real",
      failed: true,
      diagnosis: diag,
      raw: events,
    });
  }
  return out;
}

/**
 * 重组 info/message/part 三层 JSON → 事件流（messages + parts 平铺）。
 * 返回空数组表示孤儿 session（无 message 文件）。限流：先读 message 列表，
 * 按需读 part，避免一次性全加载 OOM（spec 执行提示 (4)）。
 */
export function reassembleSession(
  sessionDir: string,
  sid: string,
): unknown[] {
  const events: unknown[] = [];
  const messageDir = join(sessionDir, "message", sid);
  if (!existsSync(messageDir)) return events;
  let messageFiles: string[] = [];
  try {
    messageFiles = readdirSync(messageDir).filter((f) => f.endsWith(".json"));
  } catch {
    return events;
  }
  for (const mf of messageFiles) {
    const mid = mf.slice(0, -".json".length);
    let msg: OpenCodeMessage;
    try {
      msg = JSON.parse(readFileSync(join(messageDir, mf), "utf8")) as OpenCodeMessage;
    } catch {
      continue;
    }
    events.push(msg);
    // part 目录 = storage/session/part/<sid>/<mid>/*.json
    const partDir = join(sessionDir, "part", sid, mid);
    if (!existsSync(partDir)) continue;
    let partFiles: string[] = [];
    try {
      partFiles = readdirSync(partDir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const pf of partFiles) {
      try {
        events.push(JSON.parse(readFileSync(join(partDir, pf), "utf8")));
      } catch {
        // 非法 part → 跳过该 part（不崩）。
      }
    }
  }
  return events;
}

/**
 * 从重组事件流提取失败诊断文本。
 * 命中含 `is_error === true` 的 part → 返回其 content（string 优先，否则 JSON）；
 * 未命中失败信号 → 返回 null（调用方据此跳过非失败 session）。
 *
 * 容错多种 error 字段名（调研未给逐字段，按通用模式）：is_error / error / failed。
 */
export function extractOpenCodeDiagnosis(events: unknown[]): string | null {
  for (const ev of events as Array<Record<string, unknown>>) {
    if (!ev) continue;
    const isError =
      ev.is_error === true ||
      ev.error !== undefined ||
      ev.failed === true;
    if (!isError) continue;
    const c = ev.content ?? ev.error;
    if (typeof c === "string" && c.trim().length > 0) return c;
    if (c !== undefined && c !== null) return JSON.stringify(c);
    // 命中 error 标记但无 content → 返回占位诊断（非 null 以保留失败轨迹）。
    return ev.type ? `error in ${String(ev.type)}` : "error";
  }
  return null;
}
