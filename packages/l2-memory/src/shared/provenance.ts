// L2-T03a · provenance 写入（TL-T01 transcript 落盘）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T03a + §0.2 TL-T01 契约。
// 每次 `writeReflexion`（及后续 create/str_replace/commit 调用）附带
// `{ sessionId, taskId, promptHash, agentId, ts }` provenance 写入 transcript
// （append-only JSONL，parentUuid 形成对话树）。
//
// 委托 `@harness/telemetry` 的 `createTranscriptWriter({ baseDir })` 工厂。
// baseDir 从 `MemCtx.baseDir` 注入（ERRATA-w2plus L2-01），未注入时回退 cwd。
//
// 鲁棒性：transcript 写入失败**不得**阻断 reflexion 写主路径（transcript 是
// 观测副产物）。故采用 best-effort：异常与 rejected promise 均吞掉并仅作
// 告警。调用方（writeReflexion）是同步返回，provenance 为 fire-and-forget。

import { createTranscriptWriter } from "@harness/telemetry";
import type { MemCtx } from "../memory-tool/commands.js";

/** provenance 记录（TL-T01 契约：sessionId/taskId/promptHash/agentId/ts）。 */
export interface ProvenanceRecord {
  sessionId: string;
  taskId: string;
  promptHash: string;
  agentId: string;
  ts: number;
  /** 触发 provenance 的动作（如 'writeReflexion'）。 */
  action: string;
  /** 关联条目 id（如 reflexion note id）。 */
  refId: string;
}

/**
 * 把一条 provenance 记录写入 TL-T01 transcript（best-effort）。
 *
 * @param ctx   memory 上下文（取 baseDir/sessionId/agentId）。
 * @param rec   provenance 记录。
 */
export function appendProvenance(ctx: MemCtx, rec: ProvenanceRecord): void {
  try {
    const writer = createTranscriptWriter({
      baseDir: ctx.baseDir ?? process.cwd(),
    });
    const node = {
      parentUuid: null as string | null,
      type: "system" as const,
      sessionId: rec.sessionId,
      cwd: ctx.baseDir ?? process.cwd(),
      gitBranch: "",
      version: "",
      agentId: rec.agentId,
      content: [{ type: "text" as const, text: JSON.stringify(rec) }],
    };
    // fire-and-forget：transcript 写失败不阻断主路径
    void writer.append(node).catch(() => {
      /* best-effort: 吞掉，避免 transcript 故障传染 memory 写路径 */
    });
  } catch {
    /* best-effort：工厂或同步路径异常亦吞掉 */
  }
}
