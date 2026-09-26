// ADP-T03: Claude Code JSONL → L3 Trajectory 映射。
//
// Spec: execution/adapt/TASKS.md §ADP-T03 (trajectory.ts).
// 复用铁律（§0.2）：`Trajectory` 形状从 `@harness/l3-engine` 导入（不重定义）；
// Claude Code 事件流字段（type/parentUuid/sessionId/cwd/message/toolUseId/
// timestamp）参照 research 记录，与 TL-T01 TranscriptNode 同构但字段名 Claude
// Code 私有——`message` 嵌套一层（TL-T01 是裸 `content`），故需独立映射器，
// 不复用 pi 的 `extractDiagnosis`（后者读裸 `node.content`）。
//
// 字段映射（spec §ADP-T03 行为规范）：
//  - Claude Code `sessionId`        → Trajectory.sessionId
//  - `message` 推断 `failed`/`diagnosis`：assistant 节点 message.content 含
//    `is_error: true` 的 tool_result → failed=true，diagnosis 取其 content 文本
//  - `toolUseId`                    → Trajectory.raw（保留原始事件流备查）

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";

/** Claude Code JSONL 事件最小形状（字段参照 research 记录）。 */
export interface ClaudeEvent {
  readonly type?: string;
  readonly parentUuid?: string | null;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly message?: { readonly content?: unknown };
  readonly toolUseId?: string;
  readonly timestamp?: string;
}

/**
 * 从 Claude Code 事件流提取失败诊断 + sessionId。
 *
 * 命中 assistant 事件且 `message.content` 数组含 `is_error: true` 的
 * tool_result → 返回 `{ sessionId, diagnosis, toolUseId }`；
 * 未命中失败信号 → 返回 null（调用方据此跳过非失败 session）。
 */
export function extractClaudeDiagnosis(
  events: unknown[],
): { sessionId: string; diagnosis: string; toolUseId?: string | undefined } | null {
  let sessionId: string | undefined;
  let diagnosis: string | null = null;
  let toolUseId: string | undefined;

  for (const ev of events as ClaudeEvent[]) {
    if (ev.sessionId && sessionId === undefined) {
      sessionId = ev.sessionId;
    }
    if (ev.type !== "assistant") continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (!part || part.is_error !== true) continue;
      const c = part.content;
      if (typeof c === "string") {
        diagnosis = c;
      } else if (Array.isArray(c)) {
        const txt = c
          .map((x) =>
            typeof x === "string" ? x : (x as { text?: string })?.text ?? "",
          )
          .join(" ");
        diagnosis = txt.trim() ? txt : JSON.stringify(c);
      } else if (c !== undefined) {
        diagnosis = JSON.stringify(c);
      } else {
        diagnosis = "assistant error (no content)";
      }
      const tuid = part.tool_use_id;
      if (typeof tuid === "string") toolUseId = tuid;
      else if (ev.toolUseId !== undefined) toolUseId = ev.toolUseId;
    }
  }

  if (diagnosis === null || sessionId === undefined) return null;
  return { sessionId, diagnosis, toolUseId };
}

/**
 * 纯函数：把一组 Claude Code 事件映射为单条 L3 Trajectory（或 null）。
 * 便于单测；非失败流返回 null。
 */
export function mapClaudeEventToTrajectory(
  events: unknown[],
  substrateSha: string,
): Trajectory | null {
  const extracted = extractClaudeDiagnosis(events);
  if (extracted === null) return null;
  return {
    id: extracted.sessionId,
    sessionId: extracted.sessionId,
    substrateSha,
    failed: true,
    diagnosis: extracted.diagnosis,
    luckyPass: false,
    raw: { events, toolUseId: extracted.toolUseId },
  };
}

/**
 * 扫描 trajectoryDir 下 `<session-id>.jsonl`，逐文件解析 Claude Code 事件流，
 * 映射为 Trajectory[]。
 *
 * 行为：
 *  - 非 JSON 行 → 跳过该行并 warn（不崩），合法行仍参与诊断提取。
 *  - 整文件无法解析出失败诊断（无 is_error assistant 事件）→ 跳过该 session。
 *  - substrateSha 透传存入 Trajectory（不做过滤，由上游 CE-T03 /
 *    Lucky-Pass 守卫）。
 */
export function readClaudeTrajectories(
  trajectoryDir: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(trajectoryDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(trajectoryDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  for (const file of files) {
    const sessionId = file.slice(0, -".jsonl".length);
    const abs = join(trajectoryDir, file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    // 逐行解析：合法行入 events，非法行跳过 + warn。
    const events: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // 非法 JSONL 行 → 跳过该行（spec 错误路径：不崩）。
        // eslint-disable-next-line no-console
        console.warn(
          `[claude-code-adapter] skipping malformed JSONL line in ${file}`,
        );
      }
    }
    const traj = mapClaudeEventToTrajectory(events, substrateSha);
    if (traj === null) continue;
    // 用文件名 sessionId 兜底（防事件流缺 sessionId 字段）。
    if (!traj.sessionId) {
      (traj as { sessionId: string }).sessionId = sessionId;
      (traj as { id: string }).id = sessionId;
    }
    out.push(traj);
  }
  return out;
}
