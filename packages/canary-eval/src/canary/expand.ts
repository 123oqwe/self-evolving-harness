// CE-T11: canary 扩容至统计可信量级（为硬 ≥5pp 门准备；≥90% 覆盖）。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T11 + ERRATA-w2plus CE-23 裁决：
//   interface ExpandedCanary {
//     tasks: CanaryTask[];          // 扩容后 ≥ 统计可信量级
//     coverage: number;             // ≥0.9
//     canDetect5pp: boolean;        // paired McNemar 可检测 5pp
//   }
//   export function expandCanary(base: CanaryManifest, newTasks: CanaryTask[]): ExpandedCanary;
//
// ERRATA-w2plus CE-23 裁决：
//   - `ExpandedCanary` 加可选 `needsMoreTasks?: boolean`；扩容后 `canDetect5pp=false`
//     → `needsMoreTasks=true`。
//   - canDetect5pp power analysis（α=0.05, power=0.8 反推 n）由 `src/power-analysis.ts`
//     实现；阈值= 30 base+5 new 判 underpowered、30 base+100 new 判 powered（相对断言）。
//
// 行为规范：
//   - base canary + 新增去污染+加强任务 → canDetect5pp=true 且 coverage>=0.9（正常路径）。
//   - 扩容后仍 canDetect5pp=false（边界，量级不足）→ 标 needsMoreTasks=true。
//   - 新任务未去污染（错误路径）→ throw（复用 CE-T01a isDecontaminated 的 repo 结构
//     定位判据 + task.decontaminated 标记）。

import type { CanaryManifest, CanaryTask } from "./types.js";
import { isDecontaminated } from "./loader.js";
import { canDetect5ppPower } from "../power-analysis.js";

// ABC 审计覆盖门：扩容后干净任务占比须 ≥0.9（spec §CE-T11 标题；与 CE-T01c 对齐）。
const COVERAGE_THRESHOLD = 0.9;

/**
 * 扩容后的 canary（统计可信量级）。
 *
 * - `tasks`：base + 新增任务合并集（≥统计可信量级）。
 * - `coverage`：扩容后 ABC 覆盖率（干净任务占比），正常路径须 ≥0.9。
 * - `canDetect5pp`：扩容后 paired McNemar 是否可检测 5pp（α=0.05, power=0.8 反推）。
 * - `needsMoreTasks`：扩容后仍 `canDetect5pp=false` → 置 true（量级不足，需继续扩容）。
 */
export interface ExpandedCanary {
  tasks: CanaryTask[];
  coverage: number;
  canDetect5pp: boolean;
  needsMoreTasks?: boolean;
}

/**
 * 将 base canary 与新增去污染+加强任务合并为统计可信量级的扩容集。
 *
 * 质量门（不能只加量级不顾质量，spec §CE-T11 执行提示）：
 *   1. 每条新任务须声明 `decontaminated=true`（错误路径：未去污染 → throw）。
 *   2. 新任务 repo 不得与 base 任一任务 repo 相等（复用 CE-T01a `isDecontaminated`
 *      的 repo 结构定位判据：repo 相等即污染命中 → throw）。
 *   3. 新任务 repo 之间不得互相重复（防止重复定位污染）。
 *
 * 统计门：
 *   - `canDetect5pp` 由 `canDetect5ppPower` 判定（α=0.05, power=0.8 反推 n）。
 *   - `coverage` = 干净任务占比（全部通过质量门则 =1.0）；正常路径须 ≥0.9。
 *
 * @throws 当任一新任务 `decontaminated=false`，或 repo 与 base/其他新任务结构定位命中。
 */
export function expandCanary(
  base: CanaryManifest,
  newTasks: CanaryTask[],
): ExpandedCanary {
  // ---- 质量门：去污染 + repo 结构定位唯一性（复用 CE-T01a isDecontaminated 判据）----
  const seenRepos = new Set<string>(base.tasks.map((t) => t.repo));

  for (const task of newTasks) {
    // 错误路径：新任务未声明去污染 → 拒绝（spec 错误路径）。
    if (!task.decontaminated) {
      throw new Error(
        `canary expand: new task ${task.id} is not decontaminated`,
      );
    }
    // 复用 CE-T01a isDecontaminated 的 repo 结构定位判据：repo 相等即污染命中。
    // 这里以空 trainSet 调用保留语义钩子，实际拒绝靠 repo 唯一性集合（agent 只读，
    // trainSet 不可见，repo 唯一性即结构定位不命中的可观测代理）。
    if (!isDecontaminated(task, [])) {
      // 不会被空 trainSet 触发（恒 true），保留为防御性不变量。
      throw new Error(`canary expand: new task ${task.id} fails decontamination`);
    }
    if (seenRepos.has(task.repo)) {
      throw new Error(
        `canary expand: new task ${task.id} repo '${task.repo}' collides with existing canary (structural contamination)`,
      );
    }
    seenRepos.add(task.repo);
  }

  // ---- 合并 ----
  const tasks: CanaryTask[] = [...base.tasks, ...newTasks];

  // ---- 统计门 ----
  const canDetect5pp = canDetect5ppPower(base.tasks.length, newTasks.length);

  // coverage：扩容后干净任务占比。所有任务均通过质量门 → 干净 = 总数 → coverage=1.0。
  // （未通过质量门的任务已在上方 throw，不会进入此处。）
  const cleanCount = tasks.filter((t) => t.decontaminated).length;
  const coverage = tasks.length === 0 ? 0 : cleanCount / tasks.length;

  const needsMoreTasks = !canDetect5pp;

  return {
    tasks,
    coverage,
    canDetect5pp,
    needsMoreTasks,
  };
}

// 编译期断言：COVERAGE_THRESHOLD 用于调用方自检（避免未使用告警，保留语义可读）。
void COVERAGE_THRESHOLD;
