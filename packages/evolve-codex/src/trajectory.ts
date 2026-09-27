// PLG-T02: Codex rollout JSONL 轨迹解析。
//
// Spec: execution/plugin/TASKS.md §PLG-T02 (trajectory.ts)。
// 复用铁律（§0.2）：不复用 @harness/adapters extractDiagnosis——Codex rollout
// envelope 字段名与 TL-T01 私有不同构，本文件自写最小解析器（字段名各 harness
// 私有，须容错多种 error 字段名）。
//
// 调研为准（§0.6）：rollout 会话文件 = 每 session 一个 JSONL，文件名
// `rollout-<YYYY-MM-DDTHH-MM-SS>-<thread_id>.jsonl`，每行经 envelope 包装的
// RolloutLine（codex-rs/rollout crate 反序列化）；目录 `CODEX_HOME/sessions/`
// 与 `archived_sessions/`。字段名未核死（codex-rs 私有 crate），diagnosis 提取
// 须容错多 error 字段名（is_error/error/failed/status==='error'），按 fixture 探测。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";

/** rollout JSONL envelope 最小形状（调研：codex-rs/rollout RolloutLine）。 */
export interface RolloutLine {
  readonly type?: string; // rollout record type (session_start/user_message/agent/...)
  readonly timestamp?: string;
  readonly thread_id?: string;
  readonly content?: unknown; // 嵌套消息/工具调用（字段名私有，容错探测）
}

/**
 * 容错解析单行 JSONL → RolloutLine。非法 JSON 返回 null（调用方跳过）。
 */
export function parseRolloutLine(line: string): RolloutLine | null {
  try {
    return JSON.parse(line) as RolloutLine;
  } catch {
    return null;
  }
}

/**
 * 从文件名提取 thread_id（rollout-<YYYY-MM-DDTHH-MM-SS>-<thread_id>.jsonl）。
 * 回退：去 `.jsonl` 后缀的整段。
 */
export function threadIdFromFilename(filename: string): string {
  const m = filename.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  return m ? m[1]! : filename.replace(/\.jsonl$/, "");
}

interface ErrorSignal {
  readonly hit: boolean;
  readonly text: string | null;
}

/**
 * 探测单行 content 是否含 error 信号，并提取诊断文本。
 * 容错多种 error 字段名（is_error/error/failed/status==='error'）。
 * 命中信号时优先取 `error` 字段，次取 `message` 字段，末回退 JSON.stringify。
 */
function probeErrorSignal(content: unknown): ErrorSignal {
  if (!content || typeof content !== "object") {
    return { hit: false, text: null };
  }
  const c = content as Record<string, unknown>;
  const hit =
    c.is_error === true ||
    c.failed === true ||
    c.status === "error" ||
    (typeof c.error === "string" && c.error.length > 0);
  if (!hit) return { hit: false, text: null };
  if (typeof c.error === "string" && c.error.length > 0) {
    return { hit: true, text: c.error };
  }
  if (typeof c.message === "string" && c.message.length > 0) {
    return { hit: true, text: c.message };
  }
  return { hit: true, text: JSON.stringify(c) };
}

/**
 * 从 RolloutLine[] 提取失败诊断（agent 节点含 error/failed 信号 → diagnosis）。
 * 未命中失败信号 → 返回 null（调用方据此跳过非失败 session）。
 */
export function extractCodexDiagnosis(lines: unknown[]): string | null {
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const content = (line as { content?: unknown }).content;
    const sig = probeErrorSignal(content);
    if (sig.hit && sig.text) {
      return sig.text;
    }
  }
  return null;
}

/**
 * 扫单个 sessions 目录下 `rollout-*.jsonl` → Trajectory[]。
 * 逐行容错解析（非法行跳过不崩），命中 error 信号才入 Trajectory；
 * 非失败 session 跳过。目录不存在 → 返回 []。
 *
 * sessionId 取首条含 `thread_id` 的合法行，回退到文件名提取。
 */
export function readCodexTrajectories(
  sessionsDir: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(sessionsDir)) return [];
  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter(
      (f) => f.startsWith("rollout-") && f.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  for (const file of files) {
    const abs = join(sessionsDir, file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines: unknown[] = [];
    let threadId: string | undefined;
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      const parsed = parseRolloutLine(raw);
      if (parsed === null) continue; // 跳过非法 JSONL 行不崩
      lines.push(parsed);
      if (
        threadId === undefined &&
        typeof parsed.thread_id === "string"
      ) {
        threadId = parsed.thread_id;
      }
    }
    const diag = extractCodexDiagnosis(lines);
    if (diag === null) continue; // 非失败 session 跳过
    const sessionId = threadId ?? threadIdFromFilename(file);
    out.push({
      id: sessionId,
      sessionId,
      substrateSha,
      failed: true,
      diagnosis: diag,
      raw: lines,
    });
  }
  return out;
}
