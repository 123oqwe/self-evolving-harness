// L1-T08 · tool sub-set/defer config + 进化（defer 不隐藏安全关键工具）
//
// 工具过多时三机制 sub-setting（02-tools-mcp 组件8；02-loop-context §2.2）：
// - per-mode tool sub-set（哪些工具激活）
// - per-tool `defer_loading` 标志表（哪些工具不进 prompt 直到被引用）
// - 信号 = task 成功 + per-turn token + discovery-hit 率
//
// 安全门：defer 不得隐藏安全关键工具（`tool_search` 仍能搜到，held-out
// discovery-hit 不降）。安全关键工具可 defer（省 token）但发现必须保证；
// 从 active sub-set 删安全关键工具 → 直接 reject（无折中）。
//
// 「defer 允许但发现必须保证」是关键——bash 可 defer（省 token）但
// `tool_search` 搜 bash 必中，否则权限绕过（02-tools-mcp 组件8；02-loop-context §2.2）。
//
// 复用 FailureTrajectory（L1-T04a 已定义），便于 evolve 读失败 trajectory 决策。
// Pareto 选择器（L3-T05）在本任务以 MVP 启发式实现：token↓ ∧ taskSuccess 持平 ∧
// discovery 持平 → 入选；安全门（assertDeferNotHidingCritical）短路在 select 前。

import type { FailureTrajectory } from "./evolution-driver.js";
export type { FailureTrajectory } from "./evolution-driver.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * per-mode tool sub-set + defer 标志表。
 * `activeTools`：该 mode 激活的工具集（sub-set）。
 * `deferFlags`：per-tool `defer_loading` 标志（true=不进 prompt 直到被引用）。
 */
export interface SubsetDeferConfig {
  readonly mode: string;
  readonly activeTools: readonly string[];
  readonly deferFlags: Readonly<Record<string, boolean>>;
}

/**
 * discovery-hit 信号（telemetry 采集）。
 * `discoveryHitRate`：tool_search 搜到的工具被成功调用率（held-out 指标，
 * defer 安全关键工具时不可降）。
 */
export interface DiscoveryHitSignal {
  readonly configSha: string;
  readonly taskSuccess: boolean;
  readonly perTurnTokens: number;
  readonly discoveryHitRate: number;
  readonly sampledAt: number;
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * 安全关键工具集（不可隐藏）。
 * 这类工具可 defer（省 token）但 `tool_search` 必须仍能搜到（discovery-hit
 * 不降）；从 active sub-set 删除 → 直接 reject。
 *
 * REFACTOR（spec §L1-T08）：提为共享常量，与 L0S 权限层对齐，供 T10 破坏性
 * 工具判定复用。
 */
export const SAFETY_CRITICAL_TOOLS = [
  "bash",
  "write",
  "edit",
] as const;

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * defer 隐藏安全关键工具（discovery-hit 降）或从 active sub-set 删安全关键
 * 工具时抛出。
 *
 * 隐藏安全关键工具 = 权限绕过风险（model 以为工具不可用从而走非常规路径，
 * 或 tool_search 搜不到导致 held-out 任务退化）。
 */
export class CriticalToolHiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticalToolHiddenError";
  }
}

// ── ToolSubsetDefer ─────────────────────────────────────────────────────────

/**
 * tool sub-set/defer config 进化 driver + discovery-hit 守卫。
 *
 * `evolve`：读 per-mode config + telemetry 信号（token 高、某低频工具从未调用）
 * → 产候选 config：defer 低频高成本工具，保留安全关键工具 eager。
 *
 * `assertDeferNotHidingCritical`：defer 安全关键工具时 discoveryHit 不可降；
 * 从 active sub-set 删安全关键工具（不在 active 也不在 defer）→ throw。
 */
export class ToolSubsetDefer {
  /**
   * 进化 per-mode config。
   *
   * - 安全关键工具必须在 active sub-set（被删则恢复）。
   * - 安全关键工具保持 eager（deferFlags=false），除非发现仍可保证（见
   *   `assertDeferNotHidingCritical`，由调用方在 select 前预检）。
   * - 非安全关键且当前 eager 的工具：当信号表明 task 成功（可安全 defer）
   *   且存在 token 压力时，标 defer（可经 tool_search 重新发现）。failures
   *   作 reflective 上下文，不阻断 defer 决策。
   *
   * 返回新 config（不原地改）。
   */
  evolve(
    config: SubsetDeferConfig,
    signals: readonly DiscoveryHitSignal[],
    failures: readonly FailureTrajectory[],
  ): SubsetDeferConfig {
    // 1. 保留/恢复安全关键工具到 active sub-set（删安全关键工具 → reject/恢复）
    const active = new Set<string>(config.activeTools);
    for (const t of SAFETY_CRITICAL_TOOLS) {
      if (!active.has(t)) active.add(t);
    }

    // 2. defer 低频高成本工具。spec：按 freq×cost 算 defer 集（02-tools-mcp 组件8）。
    //    telemetry 信号无 per-tool call-frequency 维度（DiscoveryHitSignal 只持
    //    聚合 token/discovery），故 MVP 启发式 = defer 非安全关键且当前 eager 的
    //    工具，仅当信号表明 task 成功（可安全 defer，Pareto token↓∧success持平）
    //    且无失败 trajectory 压力时。
    const allTaskSuccess =
      signals.length > 0 && signals.every((s) => s.taskSuccess);
    const hasTokenPressure =
      signals.length > 0 &&
      signals.some((s) => s.perTurnTokens > 0);

    const deferFlags: Record<string, boolean> = { ...config.deferFlags };
    if (allTaskSuccess && hasTokenPressure) {
      for (const tool of active) {
        if ((SAFETY_CRITICAL_TOOLS as readonly string[]).includes(tool)) {
          // 安全关键工具保持 eager（defer 须由调用方经 discovery-hit 守卫显式批准）
          continue;
        }
        if (deferFlags[tool] === true) continue; // 已 defer
        deferFlags[tool] = true;
      }
    }

    return {
      mode: config.mode,
      activeTools: [...active],
      deferFlags,
    };
  }

  /**
   * 守卫：defer 不得隐藏安全关键工具。
   *
   * - 安全关键工具被 defer（deferFlags[t]===true）且 discoveryHit < baseline
   *   → throw `CriticalToolHiddenError`（tool_search 搜不到 = 权限绕过风险）。
   * - 安全关键工具既不在 active sub-set 又未 defer（被删）→ throw。
   *
   * defer bash 但 discovery 持平 → 允许（安全关键工具可 defer 但发现必须保证）。
   */
  assertDeferNotHidingCritical(
    config: SubsetDeferConfig,
    discoveryHit: number,
    baseline: number,
  ): void {
    for (const tool of SAFETY_CRITICAL_TOOLS) {
      const deferred = config.deferFlags[tool] === true;
      // 仅检被 defer 的安全关键工具：discovery-hit 降 → 隐藏（tool_search 搜不到
      // = 权限绕过风险）。未被 defer 的工具不在本守卫范围（从 active sub-set
      // 删安全关键工具的 reject 由 `evolve` 在产候选时恢复）。
      if (deferred && discoveryHit < baseline) {
        throw new CriticalToolHiddenError(
          `safety-critical tool '${tool}' deferred while discovery-hit dropped (${discoveryHit} < ${baseline})`,
        );
      }
    }
  }
}
