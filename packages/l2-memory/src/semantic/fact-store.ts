// L2-T06 · semantic fact 库 [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T06。
//
// 事实存为条目（带 `type` frontmatter = `user`/`feedback`/`project`/`reference`，
// CC auto-memory schema）。access-frequency 计数（确定性退化信号）+ TTL
// eviction（long-unaccessed 淘汰）+ type 门：`type:reference`/`type:project`
// 可被 agent 直接写；`type:user` 偏好类事实写需更高门槛（user 显式确认
// 或 N≥2 次独立 evidence）。canonical-path 校验拒绝 `../` 越界。
//
// 设计铁律：
//   1. **fact correctness 不可自验证**——禁同模型自评，须异模型
//      fresh-context（02-memory-skills.md 组件 1.3）。本任务只提供
//      `scheduleFreshContextReview(id)` hook 点，真实审在集成阶段接入
//      （委托 bigpowers request-review），不阻塞 T06 验收。
//   2. **type:user 高门槛**——偏好类事实易 reward hack（agent 伪造用户
//      偏好），须 user 显式确认或 ≥2 独立 evidence 才入库。
//   3. **退役 = 移 archive 不 delete**——never-auto-delete 铁律。
//   4. **MEMORY.md 200 行/25KB cap 是 static-core**——L2 不改上限
//      （跨组件复用 shared/cap-guard）。
//
// REFACTOR 备注：spec 建议把 TTL eviction 抽到 ratchet/contribution.ts 的
// shouldRetire（语义统一）。为避免与并行 T12 任务（拥有 ratchet/）冲突，
// 本任务把 TTL/退役逻辑自包含在本文件；复用 memory-bank.ts 已导出的
// RatchetParams/shouldRetire（同语义，零重复）仅用于 eviction 信号，
// shouldEvict 按 spec 独立实现（now - lastAccess > ttlMs）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export type FactType = "user" | "feedback" | "project" | "reference";

export interface Fact {
  id: string;
  type: FactType;
  content: string;
  accessFreq: number;
  lastAccess: number;
  provenance: Provenance;
}

/**
 * type:user 门槛输入（仅 type:'user' 需填；其余 type 忽略）：
 *   - userConfirmed=true  → 直接入库；
 *   - 否则需 evidenceCount>=2（独立 evidence 计数，由调用方从 trajectory
 *     聚合传入）。
 */
export interface FactGate {
  userConfirmed?: boolean;
  evidenceCount?: number;
}

/** RejectReason 为判别联合：{ ok: false; reason; msg }。 */
export type RejectReason = {
  ok: false;
  reason: "type_user_higher_gate" | "path_escape";
  msg: string;
};

// ---------------------------------------------------------------------------
// canonical-path 越界检测（`../` 拒绝）
// ---------------------------------------------------------------------------

/**
 * 检测 content 是否含 `../` 越界（含 literal 与 `%2e%2e` 编码）。
 *
 * fact-store 的 createFact 无独立 path 输入（fact 落 semantic 命名空间），
 * 故把 `../` 检测施加于 content——与 spec "createFact content/path 含 `../`
 * → path_escape" 一致。
 */
function detectPathEscape(content: string): boolean {
  if (typeof content !== "string") return false;
  // literal `../` 或 `..\`（跨平台越界）
  if (/\.\.[\\/]/.test(content)) return true;
  // URL 编码越界 `%2e%2e`
  if (/%2e%2e/i.test(content)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 异模型 fresh-context 审 hook（stub，真实审在集成阶段接入）
// ---------------------------------------------------------------------------

/** 待审 fact id 队列（异步入队，不阻塞 createFact）。 */
const freshContextQueue: string[] = [];

/**
 * 异模型 fresh-context 审 hook 点。
 *
 * 本任务只提供 hook 点（异步入队），确定性测试不覆盖（mock LLM）。
 * 真实 fresh-context 审在集成阶段接入（委托 bigpowers request-review），
 * 不阻塞 T06 验收。
 */
export function scheduleFreshContextReview(id: string): void {
  // 异步入队，不阻塞 createFact；fire-and-forget。
  freshContextQueue.push(id);
}

// ---------------------------------------------------------------------------
// 内部存储（按数据根 + 命名空间分区，fresh baseDir 得独立状态）
// ---------------------------------------------------------------------------

interface StoredFact {
  fact: Fact;
}

const store = new Map<string, StoredFact[]>();

function nsKey(ctx: MemCtx): string {
  return `${ctx.baseDir ?? process.cwd()}::${ctx.userId}::${ctx.projectId}::semantic`;
}

function bucket(ctx: MemCtx): StoredFact[] {
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
 * 创建一条 semantic fact。
 *
 * type 门：
 *   - type:'user' 须 gate.userConfirmed===true || (gate.evidenceCount??0)>=2，
 *     否则返回 RejectReason{reason:'type_user_higher_gate'}；
 *   - 其余 type（feedback/project/reference）忽略 gate，直接入库。
 *
 * canonical-path：content 含 `../` 越界返回 RejectReason{reason:'path_escape'}。
 *
 * @returns 入库后的 Fact（含生成 id、accessFreq=0、lastAccess=now）；
 *          或 RejectReason（不抛出）。
 */
export function createFact(
  fact: Omit<Fact, "id" | "accessFreq" | "lastAccess">,
  gate: FactGate,
  ctx: MemCtx,
): Fact | RejectReason {
  // canonical-path 越界检测（spec：content/path 含 `../` → path_escape）
  if (detectPathEscape(fact.content)) {
    return {
      ok: false,
      reason: "path_escape",
      msg: "createFact rejects path escape (`../` traversal) in content",
    };
  }

  // type:user 高门槛（防 reward hack：agent 伪造用户偏好）
  if (fact.type === "user") {
    const confirmed = gate.userConfirmed === true;
    const evidence = gate.evidenceCount ?? 0;
    if (!confirmed && evidence < 2) {
      return {
        ok: false,
        reason: "type_user_higher_gate",
        msg: "type:user requires userConfirmed=true or evidenceCount>=2",
      };
    }
  }

  const now = Date.now();
  const stored: Fact = {
    id: randomUUID(),
    type: fact.type,
    content: fact.content,
    accessFreq: 0,
    lastAccess: now,
    provenance: fact.provenance,
  };
  bucket(ctx).push({ fact: stored });
  return stored;
}

// ---------------------------------------------------------------------------
// 检索（access-frequency 计数）
// ---------------------------------------------------------------------------

/**
 * 读取一条 fact；accessFreq++（host-side 计数，确定性退化信号）。
 *
 * 不存在的 id 返回 undefined（调用方自行处理）。
 *
 * @param id  fact id。
 * @param ctx memory 上下文（限定数据根 + 命名空间）。
 */
export function viewFact(id: string, ctx: MemCtx): Fact {
  const arr = bucket(ctx);
  const entry = arr.find((s) => s.fact.id === id);
  if (!entry) {
    throw new Error(`fact not found: ${id}`);
  }
  entry.fact.accessFreq += 1;
  entry.fact.lastAccess = Date.now();
  return { ...entry.fact };
}

// ---------------------------------------------------------------------------
// TTL eviction
// ---------------------------------------------------------------------------

/**
 * 判定 fact 是否应被淘汰：`now - lastAccess > ttlMs`。
 *
 * 纯函数，不读取存储；确定性可测。
 */
export function shouldEvict(fact: Fact, ttlMs: number): boolean {
  return Date.now() - fact.lastAccess > ttlMs;
}

/**
 * 把 fact 移 `archive/semantic/<id>.<ts>.json`（never-auto-delete，可恢复）。
 *
 * 从 active 命名空间移除（不再参与检索 / 计分）；archive 落盘保留全量 fact。
 */
export function evict(id: string, ctx: MemCtx): void {
  const arr = bucket(ctx);
  const idx = arr.findIndex((s) => s.fact.id === id);
  if (idx < 0) return;
  const entry = arr[idx];
  if (!entry) return;
  const baseDir = ctx.baseDir ?? process.cwd();
  const archiveDir = join(baseDir, "archive/semantic");
  mkdirSync(archiveDir, { recursive: true });
  const ts = Date.now();
  const file = join(archiveDir, `${entry.fact.id}.${ts}.json`);
  const body = {
    ...entry.fact,
    archivedAt: ts,
    status: "archived",
  };
  writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  // 从 active 命名空间移除（archive 侧落盘，never-delete）。
  arr.splice(idx, 1);
}
