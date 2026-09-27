// PLG-T04: evolve-hermes · SQLite 只读查询（state.db session/message → 失败诊断）。
//
// Spec: execution/plugin/TASKS.md §PLG-T04（轨迹 = ~/.hermes/state.db，SQLite，WAL，
// FTS5；本插件只读并发安全）。复用铁律（§0.2）：轨迹解析属插件自研（Hermes
// schema 私有，不复用 extractDiagnosis）。
//
// 容错（spec §执行提示 + 任务头歧义记录）：Hermes/OpenClaw SQLite schema 未逐字
// 核实——fixture 预生成 schema（sessions/messages 两表），表名/字段名容错：
//  - sessions 表：找含 `id` 列的会话表（容错表名 sessions/session）。
//  - messages 表：找含 `session_id`+`is_error` 列的消息表（容错表名 messages/message）。
// 只读打开（readonly:true），WAL 模式下并发读不锁写端。任何打开/查询失败 → 调用方
// 收到 [] （readHermesTrajectories 不抛，由 adapter readTrajectories 统一兜底）。

import { createRequire } from "node:module";
import type { DatabaseSync as DbSync } from "node:sqlite";

// node:sqlite is an experimental Node built-in. Vite's dep optimizer does not
// recognise `node:sqlite` as a builtin (it strips the `node:` scheme and tries
// to resolve a bare `sqlite` module). Load it lazily via createRequire so the
// import is invisible to Vite's static analysis and resolved by Node at runtime.
const __require = createRequire(import.meta.url);
const DatabaseSync = __require("node:sqlite").DatabaseSync as new (
  path: string,
  opts?: { readOnly?: boolean },
) => DbSync;

/** 一个失败会话提取出的最小结构。 */
export interface HermesFailureRow {
  readonly sessionId: string;
  readonly diagnosis: string;
  readonly raw: unknown;
}

/** session 表行（容错：只取 id，title/status 可缺）。 */
interface SessionRow {
  readonly id: string;
  readonly title: string | null;
  readonly status: string | null;
}

/** message 表行（容错字段名）。 */
interface MessageRow {
  readonly id: string;
  readonly session_id: string;
  readonly role: string | null;
  readonly content: string | null;
  readonly is_error: number;
}

interface ColumnInfo {
  readonly name: string;
}

/**
 * 只读打开 state.db。打开失败（文件不存在 / 非 SQLite / corrupt）→ 返回 null。
 */
export function openHermesDbReadOnly(dbPath: string): DbSync | null {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * 在 db 中找一个表名（候选中第一个存在于 sqlite_master 的）。
 */
function findTable(db: DbSync, candidates: readonly string[]): string | null {
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = ?")
      .all("table") as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const c of candidates) {
      if (names.has(c)) return c;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 读 sessions 表所有会话行（容错字段：title/status 缺则 null）。
 */
function readSessions(db: DbSync, table: string): SessionRow[] {
  // 先探列名，构造容错 SELECT
  let cols: string[] = [];
  try {
    const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as unknown as ColumnInfo[];
    cols = info.map((c) => c.name);
  } catch {
    return [];
  }
  const has = (n: string) => cols.includes(n);
  const sel = [
    '"id"',
    has("title") ? '"title"' : "NULL AS title",
    has("status") ? '"status"' : "NULL AS status",
  ].join(", ");
  try {
    return db.prepare(`SELECT ${sel} FROM ${quoteIdent(table)}`).all() as unknown as SessionRow[];
  } catch {
    return [];
  }
}

/**
 * 读 messages 表所有消息行（容错字段名：session_id/is_error/content/role）。
 */
function readMessages(db: DbSync, table: string): MessageRow[] {
  let cols: string[] = [];
  try {
    const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as unknown as ColumnInfo[];
    cols = info.map((c) => c.name);
  } catch {
    return [];
  }
  const has = (n: string) => cols.includes(n);
  // 必须有 session_id 与 is_error 才能判定失败；缺则放弃该表
  if (!has("session_id") || !has("is_error")) return [];
  const sel = [
    has("id") ? '"id"' : "NULL AS id",
    '"session_id"',
    has("role") ? '"role"' : "NULL AS role",
    has("content") ? '"content"' : "NULL AS content",
    '"is_error"',
  ].join(", ");
  try {
    return db.prepare(`SELECT ${sel} FROM ${quoteIdent(table)}`).all() as unknown as MessageRow[];
  } catch {
    return [];
  }
}

/**
 * 从 messages 中按 session 聚合失败诊断：取该 session 第一条 is_error=1 消息的
 * content 作 diagnosis。无 error 消息的 session 不入结果（非失败轨迹跳过）。
 */
export function extractFailures(
  sessions: readonly SessionRow[],
  messages: readonly MessageRow[],
): HermesFailureRow[] {
  const bySession = new Map<string, MessageRow[]>();
  for (const m of messages) {
    if (!m.session_id) continue;
    const arr = bySession.get(m.session_id);
    if (arr) arr.push(m);
    else bySession.set(m.session_id, [m]);
  }
  const out: HermesFailureRow[] = [];
  for (const s of sessions) {
    if (!s.id) continue;
    const msgs = bySession.get(s.id) ?? [];
    const err = msgs.find((m) => Number(m.is_error) === 1);
    if (!err) continue;
    const trimmed = (err.content ?? "").trim();
    const diagnosis = trimmed.length > 0 ? trimmed : (err.content ?? "error");
    out.push({
      sessionId: s.id,
      diagnosis: typeof diagnosis === "string" && diagnosis.length > 0 ? diagnosis : "error",
      raw: { session: s, messages: msgs },
    });
  }
  return out;
}

/**
 * 读 state.db → 失败会话列表（不含非失败 session）。
 * 表不存在 / 查询失败 → 返回 []（不抛）。调用方负责关闭 db。
 */
export function queryFailures(db: DbSync): HermesFailureRow[] {
  const sessTable = findTable(db, ["sessions", "session"]);
  if (!sessTable) return [];
  const msgTable = findTable(db, ["messages", "message"]);
  if (!msgTable) return [];
  const sessions = readSessions(db, sessTable);
  const messages = readMessages(db, msgTable);
  return extractFailures(sessions, messages);
}

/** SQL 标识符引号（防注入/保留字；表名来自 sqlite_master，受信但稳妥）。 */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}
