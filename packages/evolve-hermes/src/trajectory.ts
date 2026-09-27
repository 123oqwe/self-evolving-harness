// PLG-T04: evolve-hermes · 轨迹解析（state.db → Trajectory[]）。
//
// Spec: execution/plugin/TASKS.md §PLG-T04。复用铁律（§0.2）：trajectory 解析属
// 插件自研（Hermes message 结构私有，不复用 extractDiagnosis）；Trajectory 类型
// 从 @harness/l3-engine 导入。
//
// 容错：state.db 缺失 / 非 SQLite / 表缺失 → 返回 []（不抛）。

import { existsSync } from "node:fs";
import type { Trajectory } from "@harness/l3-engine";
import {
  openHermesDbReadOnly,
  queryFailures,
} from "./db-queries.js";

/**
 * 读 <dbPath> (SQLite) 的 session/message → 失败 Trajectory[]。
 *
 *  - state.db 不存在 → []。
 *  - 非 SQLite / corrupt / 表缺失 → []（容错，不抛）。
 *  - 仅含 is_error=1 消息的 session 入结果（非失败 session 跳过，对齐 CE-T03
 *    失败轨迹语义——adapter 在此做失败过滤，luckyPass 留 undefined 由上游处理）。
 */
export function readHermesTrajectories(
  dbPath: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(dbPath)) return [];
  const db = openHermesDbReadOnly(dbPath);
  if (!db) return [];
  try {
    const failures = queryFailures(db);
    return failures.map((f) => ({
      id: f.sessionId,
      sessionId: f.sessionId,
      substrateSha,
      failed: true as const,
      diagnosis: f.diagnosis,
      raw: f.raw,
    }));
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}
