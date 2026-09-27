// PLG-T05: OpenClaw 轨迹 → L3 Trajectory 映射（SQLite + archived JSONL 双源）。
//
// Spec: execution/plugin/TASKS.md §PLG-T05 (trajectory.ts)。
// 复用铁律（§0.2）：`Trajectory` 形状从 @harness/l3-engine 导入（不重定义）；
// SQLite 用 Node 22+ 内建 `node:sqlite` 只读模式（WAL 并发安全，不写、不锁），
// 独立实现 OpenClaw schema 解析——不复用 ADP-T01 `extractDiagnosis`
// （OpenClaw transcript 表字段名私有，与 TL-T01 不同构）。
//
// 双源：
//  - SQLite：`<stateDir>/agents/<agentId>/agent/openclaw-agent.sqlite`
//    表 `transcript`（session_id/role/content/error）+ `sessions`（id/messages）。
//  - archived JSONL：`<stateDir>/agents/<agentId>/sessions/*.jsonl`（逐行 JSON）。
// 合并去重（按 sessionId）；任一源缺失不抛，回退另一源。
//
// 错误路径（spec §PLG-T05）：
//  - agentId 目录不存在 → 返回 []（不抛）。
//  - SQLite 不存在/非 SQLite/表缺失 → 跳过 sqlite 源（不抛）。
//  - JSONL 非法行 → 跳过该行（warn，不崩），合法行仍参与。
//  - 无 error 信号的 session → 不入结果（非失败轨迹跳过）。
//  - incognito 会话仅内存不留盘 → 自然读不到（合法，返回空），不特殊处理。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import type { Trajectory } from "@harness/l3-engine";

// `node:sqlite`（Node 22+，实验性）经 createRequire 动态加载，避免 vite 5.4 静态
// 分析把 `node:sqlite` 当裸模块解析（vite 内建 builtin 列表未含 sqlite）。
// 运行时仍走 Node 原生 node:sqlite，只读模式（WAL 并发安全）。
const __require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatabaseSyncCtor: typeof import("node:sqlite").DatabaseSync =
  __require("node:sqlite").DatabaseSync;

/** OpenClaw archived JSONL 事件行最小形状（容错：字段名 OpenClaw 私有）。 */
export interface OpenClawJsonlLine {
  readonly sessionId?: string;
  readonly role?: string;
  readonly content?: unknown;
  readonly text?: string;
  readonly error?: string | null;
  readonly is_error?: boolean;
  readonly failed?: boolean;
  readonly status?: string;
}

/**
 * 从 archived JSONL 事件行列表提取失败诊断 + sessionId。
 *
 * 命中任一 error 信号（`is_error===true` / `error` 非空 / `failed===true` /
 * `status==='error'`）→ 返回 `{ sessionId, diagnosis }`；未命中 → null
 * （调用方据此跳过非失败 session）。sessionId 取首个含 `sessionId` 字段的行。
 * diagnosis 取首个 error 信号文本（`error` 字段 > `content` > `text` > 摘要）。
 */
export function extractOpenClawDiagnosis(
  lines: OpenClawJsonlLine[],
): { sessionId: string; diagnosis: string } | null {
  let sessionId: string | undefined;
  let diagnosis: string | null = null;

  for (const line of lines) {
    if (sessionId === undefined && typeof line.sessionId === "string") {
      sessionId = line.sessionId;
    }
    const err = pickErrorSignal(line);
    if (err !== null && diagnosis === null) {
      diagnosis = err;
    }
  }

  if (sessionId === undefined || diagnosis === null) return null;
  return { sessionId, diagnosis };
}

/** 从单行提取 error 信号文本（容错多字段名）。null = 无信号。 */
function pickErrorSignal(line: OpenClawJsonlLine): string | null {
  if (line.is_error === true) {
    return coerceText(line.error) ?? coerceText(line.content) ?? "assistant error";
  }
  if (typeof line.error === "string" && line.error.length > 0) {
    return line.error;
  }
  if (line.failed === true) {
    return coerceText(line.content) ?? coerceText(line.text) ?? "failed";
  }
  if (line.status === "error") {
    return coerceText(line.content) ?? coerceText(line.text) ?? "status error";
  }
  return null;
}

function coerceText(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * 从 archived JSONL 目录提取 Trajectory[]。
 *
 * 行为：
 *  - 目录不存在 → 返回 []。
 *  - 逐文件逐行 JSON.parse；非法行跳过 + warn（不崩），合法行参与。
 *  - 无 error 信号的文件 → 跳过。
 *  - 同 sessionId 去重（首条胜出）。
 */
export function readOpenClawJsonlTrajectories(
  sessionsDir: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(sessionsDir)) return [];
  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const abs = join(sessionsDir, file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines: OpenClawJsonlLine[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        lines.push(JSON.parse(line) as OpenClawJsonlLine);
      } catch {
        // 非法 JSONL 行 → 跳过该行（spec 错误路径：不崩）。
        // eslint-disable-next-line no-console
        console.warn(
          `[openclaw-adapter] skipping malformed JSONL line in ${file}`,
        );
      }
    }
    const extracted = extractOpenClawDiagnosis(lines);
    if (extracted === null) continue;
    if (seen.has(extracted.sessionId)) continue;
    seen.add(extracted.sessionId);
    out.push({
      id: extracted.sessionId,
      sessionId: extracted.sessionId,
      substrateSha,
      failed: true,
      diagnosis: extracted.diagnosis,
      luckyPass: false,
      raw: { source: "jsonl", file, lines },
    });
  }
  return out;
}

/**
 * 从 OpenClaw agent SQLite 提取 Trajectory[]。
 *
 * 行为：
 *  - db 不存在/非 SQLite/open 失败 → 返回 []（不抛）。
 *  - 优先查 `transcript` 表（session_id/role/content/error）；
 *    若不存在则尝试 `sessions` 表（id/messages）。
 *  - 仅 error 信号（error 列非空 / is_error）的 session 入结果。
 *  - 同 sessionId 去重（首条胜出）。
 *
 * 只读模式（`{ readOnly: true }`）：WAL 并发安全，不锁、不写 Hermes/OpenClaw
 * 在线进程。
 */
export function readOpenClawSqliteTrajectories(
  dbPath: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSyncCtor(dbPath, { readOnly: true });
  } catch {
    // 文件不存在或无法打开 → 回退（不抛）。
    return [];
  }
  try {
    return readTranscriptTable(db, substrateSha) ?? readSessionsTable(db, substrateSha) ?? [];
  } catch {
    // 非 SQLite / 表缺失 / 查询失败 → 回退（不抛）。
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // 忽略关闭错误。
    }
  }
}

/** 查 transcript 表（session_id/role/content/error）。null = 表不存在/无数据。 */
function readTranscriptTable(
  db: DatabaseSync,
  substrateSha: string,
): Trajectory[] | null {
  let rows: { session_id: string; role: string; content: string | null; error: string | null }[];
  try {
    rows = db
      .prepare("SELECT session_id, role, content, error FROM transcript")
      .all() as typeof rows;
  } catch {
    return null;
  }
  if (rows.length === 0) return [];
  const bySession = new Map<string, string>();
  for (const r of rows) {
    const sid = r.session_id;
    if (typeof sid !== "string") continue;
    if (bySession.has(sid)) continue;
    const diag = pickSqliteError(r);
    if (diag !== null) bySession.set(sid, diag);
  }
  if (bySession.size === 0) return [];
  const out: Trajectory[] = [];
  for (const [sessionId, diagnosis] of bySession) {
    out.push({
      id: sessionId,
      sessionId,
      substrateSha,
      failed: true,
      diagnosis,
      luckyPass: false,
      raw: { source: "sqlite", table: "transcript" },
    });
  }
  return out;
}

/** 查 sessions 表（id/messages）兜底。null = 表不存在/无数据。 */
function readSessionsTable(
  db: DatabaseSync,
  substrateSha: string,
): Trajectory[] | null {
  let rows: { id: string; messages: string | null }[];
  try {
    rows = db.prepare("SELECT id, messages FROM sessions").all() as typeof rows;
  } catch {
    return null;
  }
  const out: Trajectory[] = [];
  for (const r of rows) {
    const sid = r.id;
    if (typeof sid !== "string") continue;
    const diag = extractDiagnosisFromMessages(r.messages);
    if (diag === null) continue;
    out.push({
      id: sid,
      sessionId: sid,
      substrateSha,
      failed: true,
      diagnosis: diag,
      luckyPass: false,
      raw: { source: "sqlite", table: "sessions" },
    });
  }
  return out;
}

/** 从 sessions.messages（可能为 JSON 文本）容错提取 error 信号。 */
function extractDiagnosisFromMessages(messages: string | null): string | null {
  if (typeof messages !== "string" || messages.length === 0) return null;
  // messages 可能是 JSON 文本数组，尝试解析；失败则当纯文本扫 error 关键字。
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(messages);
  } catch {
    // 纯文本：若含 error 关键字则直接返回。
    if (/error/i.test(messages)) return messages.slice(0, 200);
    return null;
  }
  if (Array.isArray(parsed)) {
    const extracted = extractOpenClawDiagnosis(parsed as OpenClawJsonlLine[]);
    return extracted?.diagnosis ?? null;
  }
  return null;
}

function pickSqliteError(r: {
  error: string | null;
  content: string | null;
}): string | null {
  if (typeof r.error === "string" && r.error.length > 0) return r.error;
  if (typeof r.content === "string" && /error/i.test(r.content)) {
    return r.content;
  }
  return null;
}

/**
 * 合并 SQLite + JSONL 双源 Trajectory[]（按 sessionId 去重，首条胜出）。
 * spec §PLG-T05 REFACTOR：双源合并抽此纯函数。
 */
export function mergeTrajectorySources(
  sqliteTrajs: Trajectory[],
  jsonlTrajs: Trajectory[],
): Trajectory[] {
  const out: Trajectory[] = [];
  const seen = new Set<string>();
  for (const t of sqliteTrajs) {
    if (seen.has(t.sessionId)) continue;
    seen.add(t.sessionId);
    out.push(t);
  }
  for (const t of jsonlTrajs) {
    if (seen.has(t.sessionId)) continue;
    seen.add(t.sessionId);
    out.push(t);
  }
  return out;
}

/**
 * 双源读取 OpenClaw agent 轨迹：
 *   <stateDir>/agents/<agentId>/agent/openclaw-agent.sqlite  (SQLite 源)
 *   <stateDir>/agents/<agentId>/sessions/*.jsonl             (archived JSONL 源)
 *
 * agentId 目录不存在 → 返回 []。SQLite 缺失 → 仅 JSONL。JSONL 缺失 → 仅 SQLite。
 */
export function readOpenClawTrajectories(
  stateDir: string,
  agentId: string,
  substrateSha: string,
): Trajectory[] {
  const agentDir = join(stateDir, "agents", agentId);
  if (!existsSync(agentDir)) return [];
  const sqlitePath = join(agentDir, "agent", "openclaw-agent.sqlite");
  const sessionsDir = join(agentDir, "sessions");
  const sqliteTrajs = readOpenClawSqliteTrajectories(sqlitePath, substrateSha);
  const jsonlTrajs = readOpenClawJsonlTrajectories(sessionsDir, substrateSha);
  return mergeTrajectorySources(sqliteTrajs, jsonlTrajs);
}
