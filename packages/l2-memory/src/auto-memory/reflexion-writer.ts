// L2-T03a · auto-memory 在线 Reflexion 写 loop [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T03a。
//
// agent 每会话末用 memory tool 写 Reflexion 笔记（self-reflection on what
// worked / what failed），落 `data/active/memory/<userId>/<projectId>/reflexion/`。
// 每条笔记带 provenance（sessionId + taskId + promptHash + agentId + ts）。
// 这是 auto-memory 的"写"半边——"退役"半边在 L2-T03b。
//
// 行为：
//   - 复用 L2-T02 executeMemory 的 `create` 命令落盘（路径
//     `/memories/reflexion/<id>`，物理映射 `reflexion/<id>.md`）。
//   - content 脱敏前置门控：含具体路径/凭据 → reject + warn（复用
//     shared/redact.ts，T05 episodic 也复用）。
//   - provenance 同步经 shared/provenance.ts 写 TL-T01 transcript。
//   - 每次 `writeReflexion` 生成新 id（randomUUID），同一 sessionId+taskId
//     重复写不覆盖（幂等性边界）。
//   - Reflexion 目录达 25KB cap 时委托 L2-T03b memory-bank 遗忘曲线淘汰
//     最低贡献（本任务不实现淘汰——只负责写；cap 由 MEMORY.md 索引层
//     `appendMemoryIndexLine` 的 tail 静默丢弃兜底）。
//
// T03a 只负责写，不负责淘汰（淘汰信号在 T03b 由 held-out 命中计贡献分）。

import { randomUUID } from "node:crypto";
import { executeMemory, type MemCtx } from "../memory-tool/commands.js";
import { detectSensitive } from "../shared/redact.js";
import { appendProvenance } from "../shared/provenance.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名一字不差）
// ---------------------------------------------------------------------------

export interface ReflexionNote {
  id: string;
  sessionId: string;
  taskId: string;
  content: string;
  promptHash: string;
  agentId: string;
  ts: number;
  outcome: "success" | "failure";
}

// ---------------------------------------------------------------------------
// 笔记渲染
// ---------------------------------------------------------------------------

/**
 * 把 ReflexionNote 渲染为落盘 markdown（YAML frontmatter + content）。
 * frontmatter 携带 provenance 元数据，content 为 agent 的 self-reflection。
 */
function renderNote(n: ReflexionNote): string {
  return [
    "---",
    `id: ${n.id}`,
    `sessionId: ${n.sessionId}`,
    `taskId: ${n.taskId}`,
    `promptHash: ${n.promptHash}`,
    `agentId: ${n.agentId}`,
    `ts: ${n.ts}`,
    `outcome: ${n.outcome}`,
    "---",
    "",
    n.content,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 写一条 Reflexion 笔记。
 *
 * @param note 笔记内容（不含 id/ts，由本函数生成）。
 * @param ctx  memory 上下文（userId/projectId/baseDir + provenance 字段）。
 * @returns 落盘后的完整笔记（含生成的 id 与 ts）。
 * @throws 当 content 含具体路径/凭据（脱敏门控 reject），或 executeMemory
 *         create 失败时抛出。
 */
export function writeReflexion(
  note: Omit<ReflexionNote, "id" | "ts">,
  ctx: MemCtx,
): ReflexionNote {
  // 1) 脱敏前置门控：含具体路径/凭据 → reject + warn
  const reason = detectSensitive(note.content);
  if (reason !== null) {
    throw new Error(
      `reflexion content rejected: ${reason} (credential/path secret redact guard)`,
    );
  }

  // 2) 生成新 id + ts（每次写新 id，不覆盖）
  const id = randomUUID();
  const ts = Date.now();
  const full: ReflexionNote = { ...note, id, ts };

  // 3) 复用 L2-T02 executeMemory create 落盘
  //    路径 /memories/reflexion/<id> 物理映射
  //    data/active/memory/<userId>/<projectId>/reflexion/<id>.md
  const path = `/memories/reflexion/${id}`;
  const result = executeMemory(
    { command: "create", path, content: renderNote(full) },
    ctx,
  );
  if (result.isError) {
    throw new Error(`writeReflexion failed to persist note: ${result.content}`);
  }

  // 4) provenance 同步写 TL-T01 transcript（best-effort，不阻断主路径）
  appendProvenance(ctx, {
    sessionId: full.sessionId,
    taskId: full.taskId,
    promptHash: full.promptHash,
    agentId: full.agentId,
    ts: full.ts,
    action: "writeReflexion",
    refId: full.id,
  });

  return full;
}
