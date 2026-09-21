// L2-T10 · Ratchet/Hermes curator 三态机 active→stale→archived。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T10 + ERRATA-w2plus L2-07。
//
// 三态机：`stale_after_days=30` 未用→stale，`archive_after_days=90`→archived。
// 跳过规则：pinned / cronReferenced / hubInstalled 永不操作（state 不变）。
// authoring prior 不可退役（移除损 43% gain，02-memory-skills.md 组件 10）。
// bounded cap C=50 经 retireIfLowContribution 间接覆盖（ERRATA L2-07）：
// 低贡献（contribution <= τ）退役，为 active 库腾出空间。
//
// never-auto-delete 铁律：退役只移 archive/，绝不物理删除（见 never-delete.ts）。

/** curator 三态。 */
export type CuratorState = "active" | "stale" | "archived";

/** curator 条目（skill 生命周期元数据）。 */
export interface CuratorEntry {
  id: string;
  state: CuratorState;
  lastUsed: number;
  pinned: boolean;
  cronReferenced: boolean;
  hubInstalled: boolean;
  /** meta-skill authoring prior——不可退役（static-core）。 */
  isAuthoringPrior: boolean;
  contribution: number;
}

// RatchetParams 由 auto-memory/memory-bank.ts 统一导出（T03b 已落地，T10/T12
// 共用）。本文件仅消费类型签名，不重复声明，避免 barrel `export *` TS2308。
import type { RatchetParams } from "../auto-memory/memory-bank.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 三态机推进：根据 `now - lastUsed` 决定 state 转移。
 *
 * - pinned / cronReferenced / hubInstalled → state 不变（跳过）。
 * - 距 lastUsed >= archiveAfterDays → archived。
 * - 距 lastUsed >= staleAfterDays → stale。
 * - 其余 → active（不变）。
 *
 * archived 是终态：一旦 archived 不回退。
 */
export function tick(
  entry: CuratorEntry,
  now: number,
  params: { staleAfterDays: number; archiveAfterDays: number },
): CuratorEntry {
  // 跳过规则：pinned / cron / hub-installed 永不操作。
  if (entry.pinned || entry.cronReferenced || entry.hubInstalled) {
    return { ...entry };
  }

  const daysSince = (now - entry.lastUsed) / DAY_MS;

  // archived 终态不回退；其余按天数推进。
  if (entry.state === "archived") {
    return { ...entry };
  }

  if (daysSince >= params.archiveAfterDays) {
    return { ...entry, state: "archived" };
  }
  if (daysSince >= params.staleAfterDays) {
    return { ...entry, state: "stale" };
  }
  return { ...entry, state: "active" };
}

/**
 * 低贡献退役：contribution <= τ 则退役为 archived。
 *
 * - authoring prior 不可退役 → 返回 null（reject "authoring prior not retirable"）。
 * - contribution <= τ → 返回 state='archived' 的副本。
 * - 否则 → 返回 null（未达退役门）。
 *
 * bounded cap C=50 溢出淘汰经此函数间接覆盖（ERRATA L2-07）：
 * active 库满时调用方对最低贡献条目调本函数退役。
 */
export function retireIfLowContribution(
  entry: CuratorEntry,
  params: RatchetParams,
): CuratorEntry | null {
  // authoring prior guard：库的自我认知能力，移除损 43% gain，不可退役。
  if (entry.isAuthoringPrior) {
    return null;
  }

  // 低贡献退役门：contribution <= τ。
  if (entry.contribution <= params.τ) {
    return { ...entry, state: "archived" };
  }

  return null;
}
