// evolve-core · OfflineMutator — offline 模式跳过 diagnosis 的 mutator 包装。
//
// Spec: execution/plugin/TASKS.md §PLG-T01 自研项（OfflineMutator）。
//
// 作用：当 harness 无文件级轨迹导出（offline 模式，如 Cursor）时，mine 步无
// failure diagnosis 可供 reflective mutation 反思。OfflineMutator 把「offline →
// 空 diagnosis」这一等价决策显式收口为命名类（而非散落在 runEvolutionCycle 里
// 的内联 `if (!offline)` 分支），与 spec 自研清单逐字对齐。
//
// 等价性：offline 时返回 []；inline ReflectiveMutator（l3-engine 内部，NoopLLM
// + 无 trajectories）见 [] 即 `return []`（reflective-mutation.ts 空失败短路），
// 与原实现「trajectories=[] 让 ReflectiveMutator 拿空 diagnosis」效果一致——
// offline 测试（`offline mode skips readTrajectories`）保持绿。非 offline 时
// 透传 harnessPort.readTrajectories，行为不变。

import type { HarnessPort } from "@harness/adapters";
import type { Trajectory } from "@harness/l3-engine";

/**
 * offline 模式跳过 diagnosis 的 mutator 包装。
 *
 * - `readDiagnosis(port, sha)`：offline → 返回 []（跳过 readTrajectories，
 *   不发任何宿主 IO）；否则 → 透传 `port.readTrajectories(sha)`。
 *
 * 这是一个「显式命名 + 单一职责」的收口类，不是新的变异算法：变异内容仍由
 * InlineEvaluator 经 harnessPort.llmPort 产出（宿主无关串联），OfflineMutator
 * 只负责 mine 步的 diagnosis 源裁决。
 */
export class OfflineMutator {
    private readonly offline: boolean;
  constructor(offline: boolean) { this.offline = offline; }

  /**
   * 裁决 mine 步的 failure diagnosis 源。
   *
   * @param port   宿主注入的 HarnessPort（offline 时不被调用）。
   * @param sha    baseline 基质 sha（online 时供 readTrajectories 过滤）。
   * @returns      offline → []；online → port.readTrajectories(sha)。
   */
  async readDiagnosis(port: HarnessPort, sha: string): Promise<Trajectory[]> {
    if (this.offline) {
      // offline：无轨迹 harness，跳过 diagnosis，不发宿主 IO。
      return [];
    }
    return port.readTrajectories(sha);
  }

  /** 是否处于 offline 模式（测试/诊断用）。 */
  get isOffline(): boolean {
    return this.offline;
  }
}
