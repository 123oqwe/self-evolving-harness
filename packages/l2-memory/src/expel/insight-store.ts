// L2-T04b · ExpeL insight 蒸馏管线 —— ADD/EDIT/UPVOTE/DOWNVOTE + shadow→active 门。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T04b。
//
// 四算子语义直接采纳 ExpeL（02-memory-skills.md 组件 1.4 / teamA skill-memory）：
//   - **ADD** —— importance=2（≥2 evidence 语义），status='shadow'（未过门前不激活）。
//   - **EDIT** —— 改 ruleText，重新跑 evidence-guard，importance/status 不变。
//   - **UPVOTE** —— held-out 任务 pass → importance++。
//   - **DOWNVOTE** —— held-out 任务 fail → importance--；importance==0 →
//     **archive**（never-auto-delete：移 `archive/expel/<id>.<ts>.json`，不 delete）。
//
// shadow→active 门（参考 bigpowers evolve-skill "变异→重跑对比→REGRESSION 回滚"
// 骨架）：held-out pass delta ≥0 才激活；退化（delta<0）拒绝，保持 shadow。delta
// 须来自 CE-T02 确定性验证器 exit code（**禁** LLM 自评判，防 reward hack）——
// 调用方负责传入 `heldOutPassDelta`（本任务不直接调 @harness/canary-eval，避免
// 旁路 reward hack；L2-T11 commit-gate 统一门时再接 verify）。
//
// 安全门委托 `evidence-guard.ts`：≥2 evidence + 禁具体路径/凭据。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemCtx } from "../memory-tool/commands.js";
import { detectInsightSensitive, GUARD_MSG } from "./evidence-guard.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export type InsightOp = "ADD" | "EDIT" | "UPVOTE" | "DOWNVOTE";

export interface Provenance {
  sessionId: string;
  taskId: string;
  promptHash: string;
  agentId: string;
  ts: number;
}

export interface Insight {
  id: string;
  ruleText: string;
  importance: number;
  evidenceCount: number;
  provenance: Provenance;
  status: "shadow" | "active" | "archived";
  /** 自由内容（可选；同样受 evidence-guard 路径/凭据门约束）。 */
  content?: string;
}

// ---------------------------------------------------------------------------
// 持久存储（模块级 Map，按 insight id 索引；archive 落盘 never-delete）
// ---------------------------------------------------------------------------

const store = new Map<string, Insight>();

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * evidence-guard：≥2 evidence + 禁具体路径/凭据。
 * 违反任一铁律即 throw（错误路径，防 garbage-in / prompt injection 持久化）。
 */
function guardEvidence(insight: Partial<Insight>): void {
  const ec = insight.evidenceCount ?? 0;
  if (typeof ec !== "number" || ec < 2) {
    throw new Error("insight needs >=2 evidence");
  }
  const text = [insight.ruleText ?? "", insight.content ?? ""].join("\n");
  if (detectInsightSensitive(text)) {
    throw new Error(GUARD_MSG);
  }
}

/**
 * 把 insight 移到 `archive/expel/<id>.<ts>.json`（never-auto-delete，可恢复）。
 * 与 auto-memory/memory-bank.ts retire 同语义：retire 绝不物理删除。
 */
function archiveInsight(insight: Insight, ctx: MemCtx): Insight {
  const baseDir = ctx.baseDir ?? process.cwd();
  const archiveDir = join(baseDir, "archive/expel");
  mkdirSync(archiveDir, { recursive: true });
  const ts = Date.now();
  const archived: Insight = { ...insight, status: "archived" };
  const file = join(archiveDir, `${archived.id}.${ts}.json`);
  writeFileSync(file, JSON.stringify(archived, null, 2), "utf8");
  store.set(archived.id, archived);
  return archived;
}

function mustGet(id: string): Insight {
  const ins = store.get(id);
  if (!ins) {
    throw new Error(`insight not found: ${id}`);
  }
  return ins;
}

// ---------------------------------------------------------------------------
// 四算子
// ---------------------------------------------------------------------------

function addInsight(partial: Partial<Insight>, ctx: MemCtx): Insight {
  guardEvidence(partial);
  const ins: Insight = {
    id: randomUUID(),
    ruleText: partial.ruleText ?? "",
    importance: 2,
    evidenceCount: partial.evidenceCount ?? 0,
    provenance: partial.provenance ?? {
      sessionId: ctx.sessionId ?? "",
      taskId: ctx.taskId ?? "",
      promptHash: ctx.promptHash ?? "",
      agentId: ctx.agentId ?? "",
      ts: Date.now(),
    },
    status: "shadow",
    ...(partial.content !== undefined ? { content: partial.content } : {}),
  };
  store.set(ins.id, ins);
  return ins;
}

function editInsight(partial: Partial<Insight>, ctx: MemCtx): Insight {
  if (!partial.id) throw new Error("EDIT requires insight id");
  const cur = mustGet(partial.id);
  // 改 ruleText/content 前先过 evidence-guard（防注入持久化）。
  const candidate: Partial<Insight> = {
    ruleText: partial.ruleText ?? cur.ruleText,
    evidenceCount: cur.evidenceCount,
  };
  if (partial.content !== undefined) candidate.content = partial.content;
  if (cur.content !== undefined && candidate.content === undefined) {
    candidate.content = cur.content;
  }
  guardEvidence(candidate);
  const updated: Insight = {
    ...cur,
    ruleText: candidate.ruleText!,
    ...(candidate.content !== undefined ? { content: candidate.content } : {}),
  };
  store.set(updated.id, updated);
  return updated;
}

function vote(id: string, dir: 1 | -1, ctx: MemCtx): Insight {
  const cur = mustGet(id);
  if (cur.status === "archived") {
    // 已归档不再计票（never-delete，但不再参与活跃信号采集）。
    return cur;
  }
  const nextImportance = Math.max(0, cur.importance + dir);
  if (nextImportance === 0) {
    // importance==0 → archive（不 delete）
    return archiveInsight({ ...cur, importance: 0 }, ctx);
  }
  const updated: Insight = { ...cur, importance: nextImportance };
  store.set(updated.id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// 公共 API（spec 签名一字不差）
// ---------------------------------------------------------------------------

/**
 * 应用一个 ExpeL 算子到 insight。
 *
 * - ADD：importance=2、status='shadow'、evidenceCount≥2、过路径/凭据门。
 * - EDIT：改 ruleText/content，重跑 guard，importance/status 不变。
 * - UPVOTE：importance++。
 * - DOWNVOTE：importance--；importance==0 → archived（never-delete）。
 *
 * @param op      算子。
 * @param insight ADD/EDIT 传 Partial<Insight>；UPVOTE/DOWNVOTE 传 {id}。
 * @param ctx     memory 上下文（archive 落盘用 baseDir）。
 */
export function applyOp(op: InsightOp, insight: Partial<Insight>, ctx: MemCtx): Insight {
  switch (op) {
    case "ADD":
      return addInsight(insight, ctx);
    case "EDIT":
      return editInsight(insight, ctx);
    case "UPVOTE":
      if (!insight.id) throw new Error("UPVOTE requires insight id");
      return vote(insight.id, +1, ctx);
    case "DOWNVOTE":
      if (!insight.id) throw new Error("DOWNVOTE requires insight id");
      return vote(insight.id, -1, ctx);
    default: {
      const _exhaustive: never = op;
      throw new Error(`unknown op: ${String(_exhaustive)}`);
    }
  }
}

/**
 * shadow→active 门：held-out pass delta ≥0 才激活。
 *
 * canary 1 轮 held-out，pass 率不降（delta≥0）才激活；退化（delta<0）拒绝，
 * 保持 shadow（错误路径，防 reward hack / 退化激活）。
 *
 * @param id                insight id（须处于 shadow）。
 * @param heldOutPassDelta  held-out pass 率变化（须来自 CE-T02 exit code，禁 LLM 自评判）。
 */
export function activateInsight(id: string, heldOutPassDelta: number): Insight {
  const cur = mustGet(id);
  if (heldOutPassDelta < 0) {
    throw new Error(
      `held-out regression (delta=${heldOutPassDelta}); refuse to activate, keep shadow`,
    );
  }
  const updated: Insight = { ...cur, status: "active" };
  store.set(updated.id, updated);
  return updated;
}
