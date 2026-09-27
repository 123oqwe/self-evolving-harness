// PLG-T07: evolve-generic — 格式声明驱动的 trajectory 解析器分发。
//
// Spec: execution/plugin/TASKS.md §PLG-T07 (parsers.ts)。
// 复用铁律（§0.2）：仅自研 4 格式分发器 + 通用诊断字段提取；Trajectory 类型从
// @harness/l3-engine 导入。**禁止**在插件包内实现进化逻辑。
//
// 依赖纪律：sqlite 格式用 Node 22+ 内建 `node:sqlite`（DatabaseSync，零新依赖），
// 不引入 better-sqlite3（spec 执行提示 (3) 建议"复用 PLG-T04/T05 只读模式经验"，
// 但本任务"禁新依赖"门控下改用内建模块）。jsonl/json 用 node:fs。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import type { Trajectory } from "@harness/l3-engine";
import type { GenericAdapterConfig } from "./config.js";

type TrajectoryCfg = GenericAdapterConfig["trajectory"];

/**
 * 格式声明驱动的 trajectory 解析器分发。
 *   - jsonl：扫 path 目录下 glob（默认 `*.jsonl`）逐行解析
 *   - json：单文件 JSON 数组
 *   - sqlite：只读打开 db，查 table 全表
 *   - none：恒 []（离线）
 * 失败诊断由 diagnosisFields OR 匹配提取；只保留 failed===true 的轨迹。
 */
export function parseTrajectories(cfg: TrajectoryCfg, substrateSha: string): Trajectory[] {
  switch (cfg.format) {
    case "jsonl":
      return parseJsonl(cfg, substrateSha);
    case "json":
      return parseJson(cfg, substrateSha);
    case "sqlite":
      return parseSqlite(cfg, substrateSha);
    case "none":
      return [];
    default:
      return [];
  }
}

/**
 * 通用诊断提取：遍历 events（对象数组），对每个 event 检查 diagnosisFields
 * 任一字段存在且 truthy → 提取为 diagnosis 字符串。OR 匹配（不要求全部命中）。
 */
export function extractByFields(
  events: ReadonlyArray<Record<string, unknown>>,
  fields: readonly string[],
): { sessionId: string; diagnosis: string } | null {
  for (const ev of events) {
    for (const f of fields) {
      const v = ev[f];
      if (v !== undefined && v !== null && v !== false && v !== "") {
        return {
          sessionId: readSessionId(ev),
          diagnosis: String(v),
        };
      }
    }
  }
  return null;
}

function readSessionId(ev: Record<string, unknown>): string {
  const s = ev.sessionId ?? ev.id ?? ev.session_id ?? ev.sid;
  return typeof s === "string" ? s : "unknown-session";
}

function buildTrajectory(
  sessionId: string,
  diagnosis: string,
  substrateSha: string,
): Trajectory {
  return {
    id: `${sessionId}#${substrateSha.slice(0, 8)}`,
    sessionId,
    substrateSha,
    failed: true,
    diagnosis,
  };
}

// ---------------------------------------------------------------------------
// jsonl
// ---------------------------------------------------------------------------

function parseJsonl(cfg: TrajectoryCfg, substrateSha: string): Trajectory[] {
  if (!existsSync(cfg.path)) return [];
  const stat = readdirIfDir(cfg.path);
  const files: string[] = [];
  if (stat === "dir") {
    const glob = cfg.glob ?? "*.jsonl";
    const pattern = globToRegex(glob);
    for (const name of readdirSync(cfg.path)) {
      if (pattern.test(name)) files.push(join(cfg.path, name));
    }
  } else {
    // path 是单文件
    files.push(cfg.path);
  }
  const out: Trajectory[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const events: Record<string, unknown>[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          events.push(obj as Record<string, unknown>);
        }
      } catch {
        // 跳过非法 JSONL 行（不崩）
      }
    }
    const hit = extractByFields(events, cfg.diagnosisFields);
    if (hit) {
      out.push(buildTrajectory(hit.sessionId, hit.diagnosis, substrateSha));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// json（单文件 JSON 数组）
// ---------------------------------------------------------------------------

function parseJson(cfg: TrajectoryCfg, substrateSha: string): Trajectory[] {
  if (!existsSync(cfg.path)) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(readFileSync(cfg.path, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const events = arr.filter(
    (x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x),
  );
  const out: Trajectory[] = [];
  for (const ev of events) {
    for (const f of cfg.diagnosisFields) {
      const v = ev[f];
      if (v !== undefined && v !== null && v !== false && v !== "") {
        const sid =
          typeof ev[cfg.sessionField ?? "sessionId"] === "string"
            ? (ev[cfg.sessionField ?? "sessionId"] as string)
            : readSessionId(ev);
        out.push(buildTrajectory(sid, String(v), substrateSha));
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// sqlite（node:sqlite 只读）
// ---------------------------------------------------------------------------

function parseSqlite(cfg: TrajectoryCfg, substrateSha: string): Trajectory[] {
  if (!cfg.table) return [];
  if (!existsSync(cfg.path)) return [];
  // node:sqlite 是 Node 22+ 内建模块；经 createRequire 运行时 require 取，
  // 避免 vite 静态分析把 `node:sqlite` 误解析为裸模块 `sqlite`。
  const DbCtor = loadNodeSqlite();
  if (DbCtor === null) return [];
  let db: { prepare: (s: string) => { all: () => unknown[] }; close: () => void };
  try {
    db = new DbCtor(cfg.path, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const rows = db.prepare(`SELECT * FROM ${cfg.table}`).all() as Record<string, unknown>[];
    const out: Trajectory[] = [];
    for (const row of rows) {
      for (const f of cfg.diagnosisFields) {
        const v = row[f];
        if (v !== undefined && v !== null && v !== false && v !== "") {
          const sid =
            typeof row[cfg.sessionField ?? "id"] === "string"
              ? (row[cfg.sessionField ?? "id"] as string)
              : readSessionId(row);
          out.push(buildTrajectory(sid, String(v), substrateSha));
          break;
        }
      }
    }
    return out;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface NodeSqliteDb {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

type NodeSqliteCtor = new (path: string, opts?: { readOnly?: boolean }) => NodeSqliteDb;

let cachedSqlite: NodeSqliteCtor | null | undefined;

function loadNodeSqlite(): NodeSqliteCtor | null {
  if (cachedSqlite !== undefined) return cachedSqlite;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("node:sqlite") as { DatabaseSync: NodeSqliteCtor };
    cachedSqlite = mod.DatabaseSync;
  } catch {
    cachedSqlite = null;
  }
  return cachedSqlite;
}

function readdirIfDir(p: string): "dir" | "file" {
  try {
    readdirSync(p);
    return "dir";
  } catch {
    return "file";
  }
}

function globToRegex(glob: string): RegExp {
  // 简单 glob → regex：* → [^/]*，? → [^/]，其余转义
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
