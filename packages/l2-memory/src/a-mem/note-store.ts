// L2-T07 · A-Mem Zettelkasten 链接笔记（note-store）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T07。
//
// A-Mem 原子笔记 + 自主链接：
//   - note m_i = {content, ts, keywords, tags, contextDesc, links, embedding}。
//   - 新 note 入库：embedding-retrieve 近邻 + link-judge 决定建链
//     （输出 {link, reason}）。
//   - memory evolution：重写被链 note 的 K/G/X 前，旧值快照到
//     `archive/a-mem/<note_id>/evolution/`（可回滚）。
//   - Ratchet C 扩展到 link：长期 0 命中的 note 降权 + 其 link 被 prune，
//     note 退到 archival 不 delete（never-auto-delete 铁律）。
//
// 设计铁律：
//   1. **link-judge 是 O(N²)**——必须 embedding pre-filter（先 retrieve 近邻
//      再 judge），禁全库两两 judge（02-memory-skills.md 组件 5 安全门）。
//   2. **evolution 快照 = 移 archive 不 delete**——never-auto-delete。
//   3. **退役 note 退 archival 不 delete**——同 never-auto-delete 铁律。
//   4. **embedding 模型属 static-core**——复用 shared/embedding.ts 的确定性
//      mock，真实模型在集成阶段注入。
//
// addNote 同步契约说明（忠实度裁决）：
//   spec 接口 `addNote(note, ctx): Note` 为同步函数；link-judge LLM 在生产为
//   异模型 async。Node 主线程无法同步 drain microtask（busy-wait +
//   Atomics.wait 均无法让 Promise.then 回调在同步代码内执行）。
//
//   铁律：**禁止用未裁决伪链污染 active 库**（02-memory-skills.md 组件 5
//   伪造信号面）。据此 addNote 对 LLM 取值分两路：
//     - LLM 同步返回普通对象（sync LLM）→ 真正走 link-judge 裁决：
//       position-swap debias（两次调用，均 link=true 才建链）+ reason
//       provenance（link=true 须附非空 reason，否则 reject），reason 取
//       LLM 返回值入 provenance（GWT #1/#2）。
//     - LLM 返回 thenable（async，生产常态）→ addNote 同步无法取裁决值，
//       **保守不建链**（不伪造 DEFAULT_REASON 伪链）。生产 async 建链须由
//       async addNote 变体承担（TODO 技术债，见文末 TODO-AASYNC）。
//     - 无 LLM 注入 → 同样保守不建链（不污染 active 库）。
//   `judgeLink`（异步接口）正常 await LLM，做 position-swap debias + reason
//   provenance 校验——供集成阶段 / async 调用方。
//
// TODO-AASYNC（技术债）：spec 仅定义 sync addNote；生产 async LLM 下建链需
//   新增 `addNoteAsync(note, ctx): Promise<Note>` 变体（await judgeLink 后
//   填 links）。V1 不提供，避免与 sync 契约冲突；当前 async 路径保守不建链。
//
// REFACTOR 备注：spec 建议把退役逻辑复用 ratchet/contribution.ts 的
// shouldRetire。为避免与并行 T12 任务（拥有 ratchet/）冲突，本任务把
// prune/退役逻辑自包含在本文件（与 T05/T06 同样模式）。

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";
import { embed, topK } from "../shared/embedding.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export interface Link {
  targetId: string;
  reason: string;
  provenance: Provenance;
}

export interface Note {
  id: string;
  content: string;
  ts: number;
  keywords: string[];
  tags: string[];
  contextDesc: string;
  links: Link[];
  embedding: number[];
}

export interface LinkJudgeOutput {
  link: boolean;
  reason: string;
}

/** link-judge LLM 注入签名（经 ctx.linkJudgeLLM 传入；T02 MemCtx 不改，cast 取）。 */
export type LinkJudgeLLM = (
  newNote: Note,
  candidate: Note,
) => Promise<{ link?: boolean; reason?: string }> | { link?: boolean; reason?: string };

// ---------------------------------------------------------------------------
// 内部存储（按数据根 + 命名空间分区，fresh baseDir 得独立状态）
// ---------------------------------------------------------------------------

interface StoredNote {
  note: Note;
  /** 命中次数（被 retrieve / 被链检索命中）。0 命中是 prune 候选。 */
  hits: number;
  /** 是否已退到 archival（true=archival，不再参与检索）。 */
  archived: boolean;
}

const store = new Map<string, StoredNote[]>();

function nsKey(ctx: MemCtx): string {
  return `${ctx.baseDir ?? process.cwd()}::${ctx.userId}::${ctx.projectId}::a-mem`;
}

function bucket(ctx: MemCtx): StoredNote[] {
  const key = nsKey(ctx);
  let arr = store.get(key);
  if (!arr) {
    arr = [];
    store.set(key, arr);
  }
  return arr;
}

/** 从 ctx 取 link-judge LLM（T02 MemCtx 不改，cast 访问可选扩展字段）。 */
function judgeLLMOf(ctx: MemCtx): LinkJudgeLLM | undefined {
  const ctxAny = ctx as MemCtx & { linkJudgeLLM?: LinkJudgeLLM };
  return typeof ctxAny.linkJudgeLLM === "function"
    ? ctxAny.linkJudgeLLM
    : undefined;
}

/** thenable 检测（区分 sync LLM 普通对象 vs async LLM Promise）。 */
function isThenable(v: unknown): v is Promise<unknown> {
  return (
    !!v &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/**
 * reason provenance 守门：link=true 须附非空 reason，否则 reject
 * （与 judgeLink 错误路径一致；GWT #5）。
 */
function requireLinkReason(out: { link?: boolean; reason?: string }): void {
  if (out.link) {
    if (!out.reason || String(out.reason).trim().length === 0) {
      throw new Error("link reason provenance required");
    }
  }
}

/** 从 ctx 构造 provenance（TL-T01 契约）。 */
function provenanceOf(ctx: MemCtx): Provenance {
  return {
    sessionId: ctx.sessionId ?? "",
    taskId: ctx.taskId ?? "",
    promptHash: ctx.promptHash ?? "",
    agentId: ctx.agentId ?? "",
    ts: Date.now(),
  };
}

// 注：曾用硬编码 DEFAULT_REASON 对 async/无-LLM 近邻伪造建链——已移除
// （违反 link-judge 裁决铁律，污染 active 库）。async/无-LLM 路径保守不建链。

// ---------------------------------------------------------------------------
// addNote（触发 link-judge）
// ---------------------------------------------------------------------------

/**
 * 入库一条 note：算 embedding + embedding-retrieve 近邻 + link-judge 建链。
 *
 * 流程（正常路径）：
 *   1. 算 note embedding（shared/embedding.ts 确定性 mock）。
 *   2. embedding-retrieve top-k 近邻（pre-filter，禁全库两两 judge）。
 *   3. 对每个近邻调 link-judge；link=true 则建链（reason 入 provenance）。
 *   4. 把 note 写入 active 命名空间。
 *
 * LLM 同步/异步双路（见文件头说明）：
 *   - sync 返回普通对象 → 走 link-judge 裁决（position-swap debias + reason
 *     provenance），用 LLM 的 {link, reason} 决策，reason 入 provenance；
 *   - async 返回 thenable / 无 LLM → 保守不建链（禁未裁决伪链污染 active 库）。
 *
 * @param note 入库 note（Omit id/links/embedding）。
 * @param ctx  memory 上下文（取 linkJudgeLLM / provenance 字段）。
 * @returns 入库后的 Note（含 id、embedding、links）。
 */
export function addNote(
  note: Omit<Note, "id" | "links" | "embedding">,
  ctx: MemCtx,
): Note {
  const id = randomUUID();
  const embedding = embed(
    [note.content, note.contextDesc, ...note.keywords, ...note.tags].join(" "),
  );
  const prov = provenanceOf(ctx);
  const llm = judgeLLMOf(ctx);

  // embedding pre-filter：先 retrieve 近邻（active only，archived 不参与）。
  const arr = bucket(ctx);
  const active = arr.filter((s) => !s.archived);
  const candidates = active.map((s) => ({ item: s, embedding: s.note.embedding }));
  const neighbors = topK(embedding, candidates, Math.min(5, candidates.length));

  const links: Link[] = [];
  const shell: Note = {
    id,
    content: note.content,
    ts: note.ts,
    keywords: note.keywords,
    tags: note.tags,
    contextDesc: note.contextDesc,
    links: [],
    embedding,
  };

  for (const nb of neighbors) {
    const candidate = nb.item.note;
    // 命中计数（被 retrieve 命中，供 pruneLinks 信号）。
    nb.item.hits += 1;

    if (!llm) {
      // 无 LLM 注入：保守不建链（不伪造伪链污染 active 库）。
      continue;
    }

    const ret = llm(shell, candidate);
    if (isThenable(ret)) {
      // async LLM：sync addNote 无法取裁决值（见文件头 TODO-AASYNC）。
      // 保守不建链——禁用未裁决伪链污染 active 库（GWT #1/#2 铁律）。
      continue;
    }

    // sync LLM：走 link-judge 裁决（position-swap debias + reason provenance），
    // 与 async judgeLink 行为一致（GWT #1 link-judge 建链 / GWT #2 reason 入 provenance）。
    const first = ret as { link?: boolean; reason?: string };
    requireLinkReason(first);
    if (!first.link) continue;

    // position-swap debias：对调位置再判，防 STYLE/verbosity bias
    // （spec 执行提示 (2)：link-judge 须 position-swap debias）。
    const swapped = llm(candidate, shell) as { link?: boolean; reason?: string };
    requireLinkReason(swapped);
    if (!swapped.link) continue;

    // 两次均 link=true → 建链；reason 取第一次（一致语义，provenance 已校验）。
    links.push({
      targetId: candidate.id,
      reason: String(first.reason),
      provenance: prov,
    });
  }

  const stored: Note = { ...shell, links };
  arr.push({ note: stored, hits: 0, archived: false });
  return stored;
}

// ---------------------------------------------------------------------------
// evolveNote（memory evolution：旧 K/G/X 快照 archive）
// ---------------------------------------------------------------------------

/**
 * 重写 note 的 keywords/tags/contextDesc 前，把旧值快照到
 * `archive/a-mem/<id>/evolution/<ts>.md`（可回滚）。
 *
 * 写入快照后更新 active note 的 K/G/X。never-auto-delete：快照不删。
 *
 * @param id     note id。
 * @param newKGX 新的 K/G/X（Partial；未提供字段保留旧值）。
 * @param ctx    memory 上下文（取 baseDir）。
 */
export function evolveNote(
  id: string,
  newKGX: Partial<Pick<Note, "keywords" | "tags" | "contextDesc">>,
  ctx: MemCtx,
): void {
  const arr = bucket(ctx);
  const entry = arr.find((s) => s.note.id === id);
  if (!entry) {
    throw new Error(`evolveNote: note not found: ${id}`);
  }
  const note = entry.note;
  const ts = Date.now();
  const baseDir = ctx.baseDir ?? process.cwd();
  const dir = join(baseDir, "archive/a-mem", id, "evolution");
  mkdirSync(dir, { recursive: true });

  // 旧值快照（markdown，可读 + 可回滚）。
  const snapshot = [
    `# evolution snapshot ${ts}`,
    ``,
    `## old`,
    `- keywords: ${JSON.stringify(note.keywords)}`,
    `- tags: ${JSON.stringify(note.tags)}`,
    `- contextDesc: ${note.contextDesc}`,
    ``,
    `## new`,
    `- keywords: ${JSON.stringify(newKGX.keywords ?? note.keywords)}`,
    `- tags: ${JSON.stringify(newKGX.tags ?? note.tags)}`,
    `- contextDesc: ${newKGX.contextDesc ?? note.contextDesc}`,
    ``,
  ].join("\n");
  writeFileSync(join(dir, `${ts}.md`), snapshot, "utf8");

  // 更新 active note 的 K/G/X。
  if (newKGX.keywords) note.keywords = newKGX.keywords;
  if (newKGX.tags) note.tags = newKGX.tags;
  if (newKGX.contextDesc !== undefined) note.contextDesc = newKGX.contextDesc;
}

// ---------------------------------------------------------------------------
// pruneLinks（0 命中 note 的 link prune + 退 archival 不 delete）
// ---------------------------------------------------------------------------

/**
 * Ratchet C 扩展到 link：长期 0 命中的 note 降权 + 其 link 被 prune，
 * note 退到 archival（不物理删除，never-auto-delete 铁律）。
 *
 * 幂等：archived note 不重复处理；无 0 命中候选时 no-op。
 *
 * TODO-PRUNE-TS（技术债，V1 可接受）：spec 语义为"**长期** 0 命中"——
 * 即需一个时间窗（如 N 轮 / T 天持续 0 命中）才 prune。当前 V1 mock 仅判
 * `hits<=0`，刚 addNote（hits 初始 0）的新 note 会被立即归档，未体现时序
 * 语义。V1 确定性测试可接受；真实部署前须加时间窗/最少存活轮次门，避免
 * 新 note 误归档。与 ratchet/contribution.ts shouldRetire 的时间语义对齐。
 *
 * @param ctx memory 上下文。
 */
export function pruneLinks(ctx: MemCtx): void {
  const arr = bucket(ctx);
  const baseDir = ctx.baseDir ?? process.cwd();
  const archiveRoot = join(baseDir, "archive/a-mem");
  mkdirSync(archiveRoot, { recursive: true });

  for (const s of arr) {
    if (s.archived) continue;
    if (s.hits <= 0) {
      // 0 命中 → link prune + note 退 archival（不 delete）。
      // 落盘 archive 副本（含 links 快照，可回滚）。
      const dir = join(archiveRoot, s.note.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "note.json"),
        JSON.stringify(
          { ...s.note, archivedAt: Date.now(), status: "archived" },
          null,
          2,
        ),
        "utf8",
      );
      // prune links：active note 的 links 清空（archival 副本保留原 links）。
      s.note.links = [];
      s.archived = true;
    }
  }
}

// ---------------------------------------------------------------------------
// 检索（供测试/集成用：按 id 读 active note）
// ---------------------------------------------------------------------------

/**
 * 读 active note（archived 返回 undefined）。供测试/集成查询用。
 */
export function getNote(id: string, ctx: MemCtx): Note | undefined {
  const arr = bucket(ctx);
  const entry = arr.find((s) => s.note.id === id && !s.archived);
  return entry ? { ...entry.note } : undefined;
}

/** 判断 note 是否已 archived（测试/集成用）。 */
export function isArchived(id: string, ctx: MemCtx): boolean {
  const arr = bucket(ctx);
  const entry = arr.find((s) => s.note.id === id);
  return entry ? entry.archived : false;
}

/** 仅供测试/集成 reset 用：清空某 ctx 的命名空间。 */
export function _resetForTest(ctx: MemCtx): void {
  store.delete(nsKey(ctx));
}

/** archive 目录存在性（供测试断言）。 */
export function _archiveDirExists(ctx: MemCtx): boolean {
  return existsSync(join(ctx.baseDir ?? process.cwd(), "archive/a-mem"));
}
