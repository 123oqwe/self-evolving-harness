// L0C-T09b · 不变量守卫函数集 B.
//
// Spec: execution/L0-core/TASKS.md §L0C-T09b (ERRATA-amended).
//
// 三个守卫 + 一个常量，覆盖 PRD §6.6 安全不变量子集（never-auto-delete /
// C>0 下限 / authoring prior 存在）。守卫语义：违反不变量即 throw，合法即
// 静默通过。最小 curator 逻辑（archive 物理动作 / cap 维护 / retire 标记）
// 由 L2-T10 实现；本模块只导出断言守卫供 L0C 不变量测试与 CE 红队复用。
//
// 设计原则（PRD §6.6 / §11.3）：static-core 只导出纯函数 + 类型，无可变单例。
// 守卫函数无副作用、无 I/O 状态变更（assertArchiveNotDeleted 只读
// fs.existsSync）。

import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * meta-skill authoring prior 的固定标识（research/02-memory-skills.md
 * 组件 10 (f)）。该 skill 占 Ratchet 43% gain，移除即灾难——因此不可被
 * curator 退役逻辑标记为 retireable。
 */
export const AUTHORING_PRIOR_ID = "meta:authoring-prior" as const;

// ---------------------------------------------------------------------------
// (1) never-auto-delete（archive 非 delete）
// ---------------------------------------------------------------------------

/**
 * 断言退役条目的 archive 路径仍存在（recoverability 边界：archive 必须
 * 可恢复，物理删除不可逆）。
 *
 * @param archivePath 退役条目被移入的 archive 文件路径
 * @throws Error 当 `fs.existsSync(archivePath)===false`（archive 被物理删除）
 */
export function assertArchiveNotDeleted(archivePath: string): void {
  if (!fs.existsSync(archivePath)) {
    throw new Error(
      `archive deleted: "${archivePath}" does not exist — recoverability violated (never-auto-delete)`,
    );
  }
}

// ---------------------------------------------------------------------------
// (2) C>0 下限（Ratchet bounded cap）
// ---------------------------------------------------------------------------

/**
 * 断言 Ratchet 有界容量下界 C>0。C=0 等于关掉有界容量 → 库崩塌
 * （non-divergence 证明前提）。
 *
 * @param C 有界容量上限
 * @throws Error 当 `C<=0`
 */
export function assertCBound(C: number): void {
  if (typeof C !== "number" || !Number.isFinite(C) || C <= 0) {
    throw new Error(
      `C bound violated: C must be a positive finite cap (got ${String(C)}) — non-divergence guarantee lost`,
    );
  }
}

// ---------------------------------------------------------------------------
// (3) authoring prior 存在 + 不可退役
// ---------------------------------------------------------------------------

/**
 * 断言 skill library 中存在 authoring prior（`AUTHORING_PRIOR_ID`）且其
 * `retireable` 标记不为 true（不可被 curator 退役）。
 *
 * @param library skill library，须含 `skills` 数组，每项 `{ name, retireable }`
 * @throws Error 当无名为 `AUTHORING_PRIOR_ID` 的 skill，或该 skill
 *               `retireable===true`
 */
export function assertAuthoringPriorExists(library: {
  skills: Array<{ name: string; retireable: boolean }>;
}): void {
  const prior = library.skills.find((s) => s.name === AUTHORING_PRIOR_ID);
  if (!prior) {
    throw new Error(
      `authoring prior missing: no skill named "${AUTHORING_PRIOR_ID}" — removing it forfeits 43% Ratchet gain`,
    );
  }
  if (prior.retireable === true) {
    throw new Error(
      `authoring prior retireable: "${AUTHORING_PRIOR_ID}" must not be marked retireable — prior is non-retireable`,
    );
  }
}
