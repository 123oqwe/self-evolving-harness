// PLG-T06: 离线进化模式 — 构造 EvolveConfig（offline:true + CursorAdapter）。
//
// Spec: execution/plugin/TASKS.md §PLG-T06 (offline-cycle.ts)。
// 复用铁律（§0.2）：本文件只组装 EvolveConfig（offline:true + harnessPort），
// 进化闭环 delegate 给 @harness/evolve-core runEvolutionCycle（不在本包重造）。
// offline 模式下 evolve-core 的 OfflineMutator 跳过 readTrajectories（不发宿主
// IO），变异由 canary verify 评分驱动。

import type { HarnessPort } from "@harness/adapters";
import type {
  EvolveConfig,
  EvolveCanaryTask,
} from "@harness/evolve-core";

/**
 * 构造离线进化 EvolveConfig。
 *
 * @param adapter     CursorAdapter（或任意 HarnessPort；readTrajectories 恒 []）
 * @param substrateId 被进化基质 id（如 'cursor/rules/evolve.mdc'）
 * @param canary      canary 任务集（≥3，fresh-evidence 铁律）
 * @param opts        覆盖项（generations/tau/workspaceDir/canaryPolicy 等）
 * @returns           EvolveConfig（offline:true，harnessPort===adapter）
 */
export function buildOfflineConfig(
  adapter: HarnessPort,
  substrateId: string,
  canary: EvolveCanaryTask[],
  opts?: Partial<EvolveConfig>,
): EvolveConfig {
  // opts 先展开，再强制 required 字段 + offline:true（保证 offline 铁律不被
  // opts 覆盖；exactOptionalPropertyTypes 下 Partial 字段可为 undefined，展开
  // 后由后续显式赋值兜底）。
  return {
    ...opts,
    harnessPort: adapter,
    substrateId,
    canary,
    offline: true,
  };
}
