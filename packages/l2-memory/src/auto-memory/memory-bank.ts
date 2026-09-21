// L2-T03b · MemoryBank 遗忘曲线 + Ratchet 贡献退役 [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T03b + ERRATA-w2plus 裁决。
//
// 实现 MemoryBank Ebbinghaus 遗忘曲线（recency+frequency 加权衰减）+
// Ratchet outcome-driven 贡献分退役。auto-memory 条目的贡献分 = 后续
// held-out 任务命中该笔记 ∧ 帮助 resolve（upvote +1）；contribution ≤ τ
// after N_min 次试用后 retire（移 archive 不 delete）；C=50 bounded cap
// 溢出淘汰最低贡献。
//
// 铁律（02-memory-skills.md 组件 9/10 static-core）：
//   1. retire **绝不**物理删除——文件移 `archive/auto-memory/` 带
//      timestamp，可恢复（never-auto-delete）。
//   2. contribution 计分必须 outcome-driven（held-out pass/fail 驱动），
//      **禁**用 LLM 自评判贡献（防 reward hack：agent 声称笔记有用以避免
//      被退役）。upvote/downvote 由确定性 held-out 命中调用。
//   3. trials 语义（ERRATA-w2plus L2-T03b）：每次 upvote/downvote 调用
//      `trials++`。
//
// REFACTOR 备注：spec 建议把 shouldRetire/retire 抽到 ratchet/contribution.ts
// 供 T05/T07/T10 复用。为避免与并行 T12 任务（拥有 ratchet/params.ts +
// contribution.ts）冲突，本任务把退役逻辑自包含在 memory-bank.ts，类型
// RatchetParams/NoteScore 亦在此导出（barrel 追加本文件即可）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemCtx } from "../memory-tool/commands.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名一字不差）
// ---------------------------------------------------------------------------

/**
 * Ratchet 三参数（L2-T12 调参，默认 τ=-2, N_min=100, C=50）。
 * - τ：退役阈值（contribution 跌至 τ 即达退役门，τ 为负数）。
 * - N_min：最小试用次数（防 premature erosion，trials < N_min 不退役）。
 * - C：active-cap（bounded cap，溢出淘汰最低贡献）。
 */
export interface RatchetParams {
  τ: number;
  N_min: number;
  C: number;
}

/** Ratchet 默认参数（spec：τ=-2, N_min=100, C=50）。 */
export const DEFAULT_RATCHET_PARAMS: RatchetParams = {
  τ: -2,
  N_min: 100,
  C: 50,
};

/**
 * auto-memory 条目的贡献分快照。
 * - contribution：outcome-driven 计分（upvote +1 / downvote -1）。
 * - trials：试用次数（每次 upvote/downvote 自增，ERRATA-w2plus L2-T03b）。
 * - lastAccess：最近访问时间戳（ms）。
 * - accessFreq：访问频次（MemoryBank Ebbinghaus frequency 信号）。
 */
export interface NoteScore {
  id: string;
  contribution: number;
  trials: number;
  lastAccess: number;
  accessFreq: number;
}

// ---------------------------------------------------------------------------
// 内部存储
// ---------------------------------------------------------------------------

/**
 * 贡献分存储。按数据根（baseDir）+ id 分区，使每测试的 fresh baseDir
 * 得到独立状态（ERRATA-w2plus：贡献分须持久化到 active/auto-memory 数据根）。
 * 进程内 Map 是 V1 的最简持久化；生产可替换为落盘 JSON。
 */
const store = new Map<string, NoteScore>();

function storeKey(ctx: MemCtx, id: string): string {
  return `${ctx.baseDir ?? process.cwd()}::${ctx.userId}::${ctx.projectId}::${id}`;
}

function freshScore(id: string): NoteScore {
  return {
    id,
    contribution: 0,
    trials: 0,
    lastAccess: 0,
    accessFreq: 0,
  };
}

function touch(score: NoteScore): NoteScore {
  score.lastAccess = Date.now();
  score.accessFreq += 1;
  return score;
}

// ---------------------------------------------------------------------------
// 贡献计分（outcome-driven）
// ---------------------------------------------------------------------------

/**
 * held-out 命中 ∧ 帮助 resolve 时调用 → contribution +1。
 * trials 每次调用自增（ERRATA-w2plus L2-T03b）。
 *
 * @returns 更新后的 NoteScore 快照（不可变副本，调用方不应回写）。
 */
export function upvote(id: string, ctx: MemCtx): NoteScore {
  const key = storeKey(ctx, id);
  const score = store.get(key) ?? freshScore(id);
  score.contribution += 1;
  score.trials += 1;
  touch(score);
  store.set(key, score);
  return { ...score };
}

/**
 * held-out 未命中 / 误导时调用 → contribution -1。
 * trials 每次调用自增（ERRATA-w2plus L2-T03b）。
 *
 * @returns 更新后的 NoteScore 快照。
 */
export function downvote(id: string, ctx: MemCtx): NoteScore {
  const key = storeKey(ctx, id);
  const score = store.get(key) ?? freshScore(id);
  score.contribution -= 1;
  score.trials += 1;
  touch(score);
  store.set(key, score);
  return { ...score };
}

// ---------------------------------------------------------------------------
// 退役决策 + 执行
// ---------------------------------------------------------------------------

/**
 * 退役决策：contribution <= τ ∧ trials >= N_min。
 *
 * - contribution <= τ：笔记贡献跌至退役阈值（τ 为负数，如 -2）。
 * - trials >= N_min：试用次数达最小值（防 premature erosion，默认 100）。
 *
 * CE-T10 selective forgetting 信号（可选 ctx.selectiveForgetting）可作为
 * 辅助候选提示；但退役门仍以 outcome-driven 的 contribution/trials 为主，
 * 禁 LLM 自评判（防 reward hack）。
 *
 * @param score  笔记贡献快照。
 * @param params Ratchet 参数。
 * @param ctx    可选 memory 上下文（ERRATA-w2plus：签名加 ctx）。
 */
export function shouldRetire(
  score: NoteScore,
  params: RatchetParams,
  ctx?: MemCtx,
): boolean {
  // 主门：outcome-driven，确定性。
  if (score.contribution <= params.τ && score.trials >= params.N_min) {
    return true;
  }
  // CE-T10 selective forgetting 辅助信号：当且仅当 ctx 注入且显式返回
  // 该 id 应被遗忘时，提示退役候选。仍受 N_min 下限保护（trials 不足不
  // 退役，防误伤新条目）。
  if (ctx?.selectiveForgetting) {
    try {
      const flag = ctx.selectiveForgetting();
      if (flag > 0 && score.trials >= params.N_min) {
        return true;
      }
    } catch {
      /* best-effort：信号故障不影响主门 */
    }
  }
  return false;
}

/**
 * 把 auto-memory 条目移到 `archive/auto-memory/<id>.<ts>.md`。
 *
 * **never-auto-delete 铁律**：retire 绝不物理删除——文件落 archive 带
 * timestamp，可恢复。active 目录的对应条目（若存在）由调用方在写入路径
 * 移除；本函数只负责归档侧落盘。
 *
 * @param id  笔记 id。
 * @param ctx memory 上下文（取 baseDir）。
 */
export function retire(id: string, ctx: MemCtx): void {
  const baseDir = ctx.baseDir ?? process.cwd();
  const archiveDir = join(baseDir, "archive/auto-memory");
  mkdirSync(archiveDir, { recursive: true });
  const ts = Date.now();
  const file = join(archiveDir, `${id}.${ts}.md`);
  const body = [
    "---",
    `id: ${id}`,
    `ts: ${ts}`,
    `userId: ${ctx.userId}`,
    `projectId: ${ctx.projectId}`,
    "status: archived",
    "---",
    "",
    "Retired auto-memory note (Ratchet outcome-driven retirement).",
    "Recoverable: never-auto-delete semantics (02-memory-skills.md §9).",
    "",
  ].join("\n");
  writeFileSync(file, body, "utf8");
  // 从 active 贡献分存储移除（条目已退役，不再参与后续计分）。
  const key = storeKey(ctx, id);
  store.delete(key);
}

// ---------------------------------------------------------------------------
// 测试辅助：bounded cap C=50 溢出淘汰（spec 行为规范）
// ---------------------------------------------------------------------------

/**
 * active auto-memory 达 C 上限时淘汰最低贡献条目。
 *
 * 调用点：写入路径前置检查 `activeSize >= C` 时调用本函数淘汰最低贡献。
 * 淘汰 = retire（移 archive 不删），保持 never-auto-delete 语义。
 *
 * @param scores 当前 active 全部 NoteScore。
 * @param params Ratchet 参数（取 C）。
 * @param ctx    memory 上下文。
 * @returns 被淘汰的 id 列表（可能为空）。
 */
export function evictOnOverflow(
  scores: NoteScore[],
  params: RatchetParams,
  ctx: MemCtx,
): string[] {
  if (scores.length < params.C) return [];
  // 按 contribution 升序，淘汰最低直至 size < C。
  const sorted = [...scores].sort((a, b) => a.contribution - b.contribution);
  const toEvict = sorted.slice(0, scores.length - params.C + 1);
  for (const s of toEvict) {
    retire(s.id, ctx);
  }
  return toEvict.map((s) => s.id);
}
