// PLG-T12: grok 会话日志 JSONL → L3 Trajectory 映射。
//
// Spec: execution/plugin/TASKS.md §PLG-T12（trajectory.ts）。
//
// 复用铁律（§0.2）：`Trajectory` 形状从 `@harness/l3-engine` 导入（不重定义）。
// grok 会话日志的字段名调研未逐字核实（执行时 fetch github.com/xai-org/grok-build
// 的 docs 未果 / 未注入 sessionLogPath），故本解析器**仅在 sessionLogPath 注入时
// 启用**；未注入则 `readGrokTrajectories` 恒 `[]`（offline 降级，同 Cursor PLG-T06）。
//
// 诊断提取容错多 error 字段名（同 PLG-T02 codex 模式）：`is_error`/`error`/
// `failed`/`status==='error'`，不硬编码单一 schema（调研未给出逐字段）。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";

/** grok 会话日志事件最小形状（字段名调研未逐字核实，容错解析）。 */
export interface GrokLogLine {
  readonly type?: string;
  readonly sessionId?: string;
  readonly session_id?: string;
  readonly id?: string;
  readonly content?: unknown;
  readonly is_error?: boolean;
  readonly error?: string | unknown;
  readonly failed?: boolean;
  readonly status?: string;
  readonly message?: string | unknown;
}

/**
 * 从单条 grok 日志行提取失败诊断 + sessionId。
 *
 * 命中以下任一 error 信号即判 failed：
 *  - `content.is_error === true`
 *  - `content.error` 非空 / `content.failed === true` / `content.status === 'error'`
 *  - 顶层 `is_error`/`error`/`failed`/`status==='error'`（content 缺失时兜底）
 *
 * diagnosis 取 `content.error`/`content.message`/顶层 `error`/`message`，
 * 否则 JSON.stringify(content)。
 *
 * 未命中失败信号 → 返回 null（调用方据此跳过非失败 session）。
 */
export function extractGrokDiagnosis(
  line: unknown,
): { sessionId: string; diagnosis: string } | null {
  const ev = line as GrokLogLine;
  const sessionId =
    ev.sessionId ?? ev.session_id ?? ev.id ?? undefined;
  if (sessionId === undefined) return null;

  const content =
    ev.content !== undefined && typeof ev.content === "object"
      ? (ev.content as Record<string, unknown>)
      : null;

  const isError =
    ev.is_error === true ||
    ev.failed === true ||
    ev.status === "error" ||
    (content !== null &&
      (content.is_error === true ||
        content.failed === true ||
        content.status === "error" ||
        content.error !== undefined));

  if (!isError) return null;

  let diagnosis: string | null = null;
  const pickStr = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0
      ? v
      : v !== undefined && v !== null
        ? JSON.stringify(v)
        : null;

  if (content !== null) {
    diagnosis =
      pickStr(content.error) ??
      pickStr(content.message) ??
      JSON.stringify(content);
  }
  if (diagnosis === null) {
    diagnosis = pickStr(ev.error) ?? pickStr(ev.message) ?? "grok error (no content)";
  }

  return { sessionId, diagnosis };
}

/**
 * 纯函数：把一组 grok 日志行映射为单条 L3 Trajectory（或 null）。
 * 非失败流返回 null。
 */
export function mapGrokLineToTrajectory(
  lines: unknown[],
  substrateSha: string,
): Trajectory | null {
  for (const line of lines) {
    const extracted = extractGrokDiagnosis(line);
    if (extracted !== null) {
      return {
        id: extracted.sessionId,
        sessionId: extracted.sessionId,
        substrateSha,
        failed: true,
        diagnosis: extracted.diagnosis,
        luckyPass: false,
        raw: { lines },
      };
    }
  }
  return null;
}

/**
 * 读取 grok 会话日志 → Trajectory[]。
 *
 * 行为：
 *  - `sessionLogPath` 为 undefined / 不存在 → 返回 `[]`（offline 降级铁律）。
 *  - `sessionLogPath` 指向单文件（.jsonl）→ 解析该文件。
 *  - `sessionLogPath` 指向目录 → 扫其下 `*.jsonl`。
 *  - 非法 JSON 行 → 跳过该行 + warn（不崩），合法行仍参与。
 *  - 整文件无失败信号 → 跳过该 session。
 */
export function readGrokTrajectories(
  sessionLogPath: string | undefined,
  substrateSha: string,
): Trajectory[] {
  if (sessionLogPath === undefined) return [];
  if (!existsSync(sessionLogPath)) return [];

  let files: string[] = [];
  try {
    const st = statSync(sessionLogPath);
    if (st.isDirectory()) {
      files = readdirSync(sessionLogPath)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(sessionLogPath, f));
    } else {
      files = [sessionLogPath];
    }
  } catch {
    return [];
  }

  const out: Trajectory[] = [];
  for (const abs of files) {
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        lines.push(JSON.parse(line));
      } catch {
        // 非法 JSONL 行 → 跳过（spec 错误路径：不崩）。
        // eslint-disable-next-line no-console
        console.warn(
          `[grok-adapter] skipping malformed JSONL line in ${abs}`,
        );
      }
    }
    const traj = mapGrokLineToTrajectory(lines, substrateSha);
    if (traj === null) continue;
    out.push(traj);
  }
  return out;
}
