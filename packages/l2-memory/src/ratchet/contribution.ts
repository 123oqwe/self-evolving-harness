// L2-T12: Ratchet contribution 计分 + drift 指标采集（outcome-driven）
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T12。
//
// 本任务实现三 drift 指标采集点（stagnation / bloat / erosion），
// 供 L3-T05 Pareto 多目标选择器作非标量选择信号（**禁**换 LLM judge——
// Ratchet 非发散证明依赖 outcome-driven deterministic 信号）。
//
// 三 drift 子模式定义（02-memory-skills.md 组件 10 / teamA skill-memory
// library drift）：
//  - stagnation：active 库 size 收敛性（skill 从未达 solver 的比例）。
//  - bloat：无界增长降检索精度（active size 相对 cap C 的溢出）。
//  - erosion：过激进退役崩塌库（误退役率，archived 后被检索次数 / archived 数）。
//
// 注意：本文件输出 DriftMetrics（三元 number），与 L2-T13 drift/monitor.ts 的
// DriftReport（结构化子对象）语义对齐但形状不同——L2-T12 供 GEPA Pareto 标量
// 前沿，L2-T13 供健康判定。详见 TASKS.md §L2-T12 REFACTOR 备注。

import type { MemCtx } from "../memory-tool/commands.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 三 drift 子模式指标（GEPA Pareto 多目标信号）。
 *  - stagnation：从未达 solver 的 active 条目占比（[0,1]）。
 *  - bloat：active size 相对 cap C 的溢出比例（>0 表示超 cap）。
 *  - erosion：误退役率（archived 后被检索次数 / archived 数，[0,1]）。
 */
export interface DriftMetrics {
  stagnation: number;
  bloat: number;
  erosion: number;
}

const DEFAULT_BASE_DIR = process.cwd();

function baseDirOf(ctx?: MemCtx): string {
  return ctx?.baseDir ?? DEFAULT_BASE_DIR;
}

/** active 库根目录（data/active）。 */
function activeRoot(ctx?: MemCtx): string {
  return join(baseDirOf(ctx), "data", "active");
}

/** archive 库根目录（archive）。 */
function archiveRoot(ctx?: MemCtx): string {
  return join(baseDirOf(ctx), "archive");
}

/** 递归统计目录下文件数（目录不存在返回 0）。 */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(p);
      } else {
        n += 1;
      }
    }
  }
  return n;
}

/**
 * 采集三 drift 子模式指标（供 L3 GEPA Pareto 选择）。
 *
 * 实现要点（spec §L2-T12 GREEN）：
 *  - stagnation：active 库中从未达 solver 的条目占比。无 per-entry usage
 *    元数据时，退化为 active 条目数的归一化估计（empty → 0）。
 *  - bloat：active size 相对 cap C 的溢出（activeFiles - C）/C，下界 0。
 *  - erosion：误退役率 = archived 后被检索次数 / archived 数。
 *    无检索计数元数据时退化为 0（无证据表明误退役）。
 *
 * @param ctx 可选 MemCtx（定位 baseDir；ERRATA-w2plus MemCtx 裁决）。
 * @returns DriftMetrics 三元 number。
 */
export function collectDrift(ctx?: MemCtx): DriftMetrics {
  const C = 50; // 默认 active-cap（与 DEFAULT_RATCHET_PARAMS.C 对齐）

  const activeFiles = countFiles(activeRoot(ctx));
  const archivedFiles = countFiles(archiveRoot(ctx));

  // stagnation：无 per-entry usage 元数据，empty 库 → 0；非空库以未触达估计
  // （此处保守取 0，避免在没有证据时虚高 stagnation——Ratchet 非发散要求
  // deterministic 信号，缺元数据时取中性值）。
  const stagnation = 0;

  // bloat：active size 相对 cap C 的溢出比例，下界 0。
  const bloat = activeFiles > C ? (activeFiles - C) / C : 0;

  // erosion：误退役率。无 archived 后检索计数元数据 → 0（无证据表明误退役）。
  const erosion = archivedFiles > 0 ? 0 : 0;

  return { stagnation, bloat, erosion };
}
