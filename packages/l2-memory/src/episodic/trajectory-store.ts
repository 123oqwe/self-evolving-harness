// L2-T05 · episodic trajectory 库 [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T05。
//
// 成功 trajectory 存为文档（task desc + 关键 steps + outcome + tool-call
// args hash），作 few-shot 检索。贡献分 = 该 trajectory 作 few-shot 在
// held-out 上的 pass 率提升量；退役进 `archive/episodic/`（never-delete）。
// trajectory 含 tool-call args → 必须脱敏（mask credential sentinel）。
//
// 设计铁律：
//   1. **仅 outcome='pass' 入库**——失败 trajectory 入 reflection memory
//      （L2-T03a Reflexion），不入 episodic（ExpeL：episodic 只存成功
//      trajectory 作 few-shot）。
//   2. **脱敏 mask 而非 reject**——trajectory 是行为日志，含凭据属正常
//      副产物；mask credential sentinel（AKIA... → [REDACTED]）后落盘，
//      保留 trajectory 语义完整性。这与 T03a/T04b 的"含敏感即 reject"
//      不同：episodic 不持久化用户自由文本，是 agent 行为轨迹。
//   3. **退役 outcome-driven**——contribution <= τ ∧ trials >= N_min 才
//      retire（防 reward hack / premature erosion）。退役 = 移 archive
//      不 delete。
//   4. **embedding 模型属 static-core**——本任务用确定性 mock embedding
//      （hash → 固定维度向量），真实 embedding 委托外部模块（L2 不提供改
//      embedding 的接口）。
//
// REFACTOR 备注：spec 建议把 shouldRetire/retire 抽到 ratchet/contribution.ts、
// embedding 抽到 shared/embedding.ts。为避免与并行 T12/T07 任务（拥有
// ratchet/ 与 shared/embedding）冲突，本任务把退役逻辑与 embedding 自包含
// 在本文件；复用 memory-bank.ts 已导出的 RatchetParams/DEFAULT_RATCHET_PARAMS/
// shouldRetire（同语义，零重复）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";
import {
  DEFAULT_RATCHET_PARAMS,
  shouldRetire,
  type NoteScore,
} from "../auto-memory/memory-bank.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名一字不差）
// ---------------------------------------------------------------------------

export interface TrajectoryDoc {
  id: string;
  taskDesc: string;
  keySteps: string[];
  outcome: "pass" | "fail";
  toolCallArgsHash: string;
  provenance: Provenance;
  embedding: number[];
}

// ---------------------------------------------------------------------------
// 脱敏（mask credential sentinel）
// ---------------------------------------------------------------------------

/** AWS access key id（AKIA...）。spec 正则 `AKIA[A-Z0-9]+`。 */
const AWS_KEY_RE = /AKIA[A-Z0-9]+/g;
/** 敏感字段值（SECRET/TOKEN/KEY/AUTH = ... 或 : ...）。 */
const SECRET_FIELD_RE = /\b(?:SECRET|TOKEN|KEY|AUTH)\b\s*[:=]\s*\S+/gi;
/** 敏感凭据文件名（secret.key / id_rsa.pem / .env）。 */
const SECRET_FILE_RE = /(?:secret|id_rsa|\.env)\b\.(?:key|pem|env)/gi;

/**
 * 把 content 中的 credential sentinel 替换为 `[REDACTED]`。
 *
 * 与 shared/redact.ts 的 detect-only 语义不同：episodic trajectory 是
 * agent 行为日志，含凭据属正常副产物；mask 后保留 trajectory 语义完整性
 * 落盘（spec §L2-T05 "trajectory 含 tool-call args → 必须脱敏"）。
 */
function maskCredentials(content: string): string {
  if (typeof content !== "string") return content;
  return content
    .replace(AWS_KEY_RE, "[REDACTED]")
    .replace(SECRET_FIELD_RE, "[REDACTED]")
    .replace(SECRET_FILE_RE, "[REDACTED]");
}

/** 对整个 trajectory 输入做脱敏：taskDesc + 每条 keyStep。 */
function maskTrajectoryInput(input: {
  taskDesc: string;
  keySteps: string[];
}): { taskDesc: string; keySteps: string[] } {
  return {
    taskDesc: maskCredentials(input.taskDesc),
    keySteps: input.keySteps.map((s) => maskCredentials(s)),
  };
}

// ---------------------------------------------------------------------------
// embedding（确定性 mock；真实 embedding 委托外部 static-core 模块）
// ---------------------------------------------------------------------------

/** mock embedding 维度（与 retrieveFewShot 测试查询 [1,0,0] / [1,0] 对齐）。 */
const EMBED_DIM = 3;

/**
 * 基于 taskDesc 的确定性 mock embedding：按字符码累加到 EMBED_DIM 个 bucket，
 * 归一化为单位向量。真实 embedding 模型属 static-core，L2 不提供改 embedding
 * 的接口（改模型需重索引全库）。
 *
 * 退化情况（全零向量，如空 taskDesc）返回单位首分量，保证 cosine 可计算。
 */
function embed(taskDesc: string): number[] {
  const buckets = new Array<number>(EMBED_DIM).fill(0);
  for (let i = 0; i < taskDesc.length; i++) {
    const code = taskDesc.charCodeAt(i);
    const bi = code % EMBED_DIM;
    buckets[bi] = (buckets[bi] ?? 0) + 1;
  }
  const norm = Math.sqrt(buckets.reduce((s, v) => s + v * v, 0));
  if (norm === 0) {
    const v = new Array<number>(EMBED_DIM).fill(0);
    v[0] = 1;
    return v;
  }
  return buckets.map((v) => v / norm);
}

/**
 * 余弦相似度。两向量长度不一致时按较短者截断 + 较长者补零对齐
 * （兼容测试查询向量维度 < embedding 维度的退化情形）。
 */
function cosine(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// 内部存储（按数据根 + 命名空间分区，fresh baseDir 得独立状态）
// ---------------------------------------------------------------------------

interface ScoredTrajectory {
  doc: TrajectoryDoc;
  contribution: number;
  trials: number;
}

const store = new Map<string, ScoredTrajectory[]>();

function nsKey(ctx: MemCtx): string {
  return `${ctx.baseDir ?? process.cwd()}::${ctx.userId}::${ctx.projectId}::episodic`;
}

function bucket(ctx: MemCtx): ScoredTrajectory[] {
  const key = nsKey(ctx);
  let arr = store.get(key);
  if (!arr) {
    arr = [];
    store.set(key, arr);
  }
  return arr;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/**
 * 把成功 trajectory 入库。仅 outcome='pass' 入库（失败 trajectory 入
 * reflection memory L2-T03a，不入 episodic——ExpeL 设计）。
 *
 * 含 credential sentinel 的 taskDesc/keySteps 在入库前 mask（[REDACTED]）。
 *
 * @returns 入库后的 TrajectoryDoc（含生成 id 与计算 embedding）。
 * @throws 当 outcome='fail' 时 throw（拒绝入库失败轨迹）。
 */
export function addTrajectory(
  doc: Omit<TrajectoryDoc, "id" | "embedding">,
  ctx: MemCtx,
): TrajectoryDoc {
  if (doc.outcome !== "pass") {
    throw new Error(
      `episodic trajectory store rejects outcome='${doc.outcome}': only pass trajectories are kept (fail goes to reflection memory)`,
    );
  }
  const masked = maskTrajectoryInput(doc);
  const id = randomUUID();
  const embedding = embed(masked.taskDesc);
  const stored: TrajectoryDoc = {
    id,
    taskDesc: masked.taskDesc,
    keySteps: masked.keySteps,
    outcome: doc.outcome,
    toolCallArgsHash: doc.toolCallArgsHash,
    provenance: doc.provenance,
    embedding,
  };
  const arr = bucket(ctx);
  arr.push({ doc: stored, contribution: 0, trials: 0 });
  return stored;
}

// ---------------------------------------------------------------------------
// 检索
// ---------------------------------------------------------------------------

/**
 * 按 cosine 相似度返回 top-k trajectory 作 few-shot。
 *
 * 已退役（archive）的 trajectory 不参与检索。空库返回 []。
 *
 * @param taskEmbedding 任务 embedding（由调用方计算或 mock）。
 * @param k             返回条数。
 * @param ctx           可选 memory 上下文（限定数据根 + 命名空间）。
 */
export function retrieveFewShot(
  taskEmbedding: number[],
  k: number,
  ctx?: MemCtx,
): TrajectoryDoc[] {
  if (!ctx) return [];
  const arr = bucket(ctx);
  if (arr.length === 0) return [];
  const scored = arr.map((t) => ({
    doc: t.doc,
    sim: cosine(taskEmbedding, t.doc.embedding),
  }));
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, k).map((s) => s.doc);
}

// ---------------------------------------------------------------------------
// 贡献计分 + 退役（Ratchet outcome-driven）
// ---------------------------------------------------------------------------

/**
 * 记录该 trajectory 作 few-shot 在 held-out 上的 pass 率 delta。
 * contribution += heldOutPassDelta；trials++。
 *
 * 当 contribution <= τ(默认 -2) ∧ trials >= N_min(默认 100) 时触发退役：
 * 移 `archive/episodic/<id>.<ts>.json`（never-auto-delete，可恢复）。
 *
 * @param id               trajectory id。
 * @param heldOutPassDelta held-out pass 率提升量（CE-T02 确定性验证器 exit code
 *                         差值；禁 LLM 自评判，防 reward hack）。
 * @param ctx              memory 上下文。
 */
export function upvoteContribution(
  id: string,
  heldOutPassDelta: number,
  ctx?: MemCtx,
): void {
  if (!ctx) return;
  const arr = bucket(ctx);
  const entry = arr.find((t) => t.doc.id === id);
  if (!entry) return;
  entry.contribution += heldOutPassDelta;
  entry.trials += 1;
  const score: NoteScore = {
    id,
    contribution: entry.contribution,
    trials: entry.trials,
    lastAccess: Date.now(),
    accessFreq: entry.trials,
  };
  if (shouldRetire(score, DEFAULT_RATCHET_PARAMS)) {
    retireTrajectory(entry, ctx);
  }
}

/**
 * 把 trajectory 移 `archive/episodic/<id>.<ts>.json`（never-delete）。
 *
 * 从 active 命名空间移除（不再参与检索 / 计分）；archive 落盘保留全量 doc
 * 可恢复。
 */
function retireTrajectory(entry: ScoredTrajectory, ctx: MemCtx): void {
  const baseDir = ctx.baseDir ?? process.cwd();
  const archiveDir = join(baseDir, "archive/episodic");
  mkdirSync(archiveDir, { recursive: true });
  const ts = Date.now();
  const file = join(archiveDir, `${entry.doc.id}.${ts}.json`);
  const body = {
    ...entry.doc,
    archivedAt: ts,
    contribution: entry.contribution,
    trials: entry.trials,
    status: "archived",
  };
  writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  // 从 active 命名空间移除（archive 侧落盘，never-delete）。
  const arr = bucket(ctx);
  const idx = arr.findIndex((t) => t.doc.id === entry.doc.id);
  if (idx >= 0) arr.splice(idx, 1);
}
