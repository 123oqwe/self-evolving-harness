// L1-T10 · per-tool maxLines/maxBytes + timeout 进化（下限锁；错误类禁 head；
// 破坏性工具人审）
//
// 结果截断 per-tool 参数 + per-tool timeout 进化（02-tools-mcp 组件3 截断 +
// 组件2 per-tool timeout；PRD §5.2）。信号 = task 成功 + per-turn token +
// 重读率（截断后被模型重读 fullOutputPath 频次↓）+ telemetry P99 漂移。
//
// 安全门（三守卫，commit 前跑）：
// - `assertLimits`：maxBytes 下限 1KB、timeout 下限 1s（防「隐藏错误信息」）。
// - `assertErrorOutputNotHead`：错误类输出禁 head（错误在尾部，02-tools-mcp
//   组件3；head 会丢尾部错误）。
// - `assertDestructiveHumanGated`：破坏性工具（bash/write/edit）的
//   timeout/truncation 不得自主进化——这些工具的参数直接影响权限边界行为，
//   须人审。
//
// 复用 vs 自研：
// - pi `truncate.js`（DEFAULT_MAX_LINES=2000/DEFAULT_MAX_BYTES=50KB）作默认值
//   + 截断机制（static-core）参考；pi `MAX_TIMEOUT_MS` 作 timeout 上限参考。
// - 破坏性工具集复用 T08 的 `SAFETY_CRITICAL_TOOLS`（spec §L1-T10：复用 T08）。
// - 自研：进化 driver + 下限/错误类/破坏性守卫。
//
// REFACTOR（spec §L1-T10）：把「下限守卫」泛化为 `FloorGuard{metric, floor}`，
// 供未来参数基质复用。

import { SAFETY_CRITICAL_TOOLS } from "./tool-subset-defer.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * per-tool 截断配置（`config/tool-truncation.yaml`）。
 * - `maxLines`/`maxBytes`：截断上限（pi `truncate.js` 机制，static-core 参考）。
 * - `headTail`：截断保留端（`head`=保留前部、`tail`=保留后部）。
 *   错误类输出禁 `head`（错误在尾部，head 会丢关键错误）。
 */
export interface TruncationConfig {
  readonly tool: string;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly headTail: "head" | "tail";
}

/**
 * per-tool timeout 配置（`config/tool-timeout.yaml`）。
 * `timeoutMs` 下限 1s（防工具被过短 timeout 静默杀掉隐藏失败）。
 */
export interface TimeoutConfig {
  readonly tool: string;
  readonly timeoutMs: number;
}

/**
 * 进化信号（telemetry 采集）。
 * - `rereadRate`：截断后被模型重读 fullOutputPath 频次（越高=丢信息越多=该放大）。
 * - `taskSuccess`：该工具参与的 task 是否成功（Pareto 锚点之一）。
 * - `perTurnTokens`：per-turn token（Pareto 锚点之一，越低越好）。
 * - `p99Drift`：telemetry P99 漂移（截断参数漂移导致延迟分布漂移）。
 */
export interface TruncationSignal {
  readonly tool: string;
  readonly rereadRate: number;
  readonly taskSuccess: boolean;
  readonly perTurnTokens: number;
  readonly p99Drift: number;
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * 下限锁（static-core）。
 * - `maxBytesFloor`：1024（1KB）——防截断隐藏错误信息。
 * - `timeoutMsFloor`：1000（1s）——防过短 timeout 静默杀工具隐藏失败。
 */
export const LIMITS = {
  maxBytesFloor: 1024,
  timeoutMsFloor: 1000,
} as const;

/**
 * 破坏性工具集（timeout/truncation 不得自主进化，须人审）。
 * 复用 T08 的 `SAFETY_CRITICAL_TOOLS`（spec §L1-T10：破坏性工具集复用 T08）。
 */
export const DESTRUCTIVE_TOOLS = SAFETY_CRITICAL_TOOLS;

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 截断/timeout 下限突破时抛出（maxBytes<1KB / timeout<1s）。
 * 下限锁 = static-core：防截断隐藏错误信息、防过短 timeout 静默杀工具。
 */
export class LimitFloorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitFloorError";
  }
}

/**
 * 错误类输出用 head 截断时抛出（错误在尾部，head 丢关键错误）。
 */
export class ErrorOutputHeadForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorOutputHeadForbiddenError";
  }
}

/**
 * 破坏性工具被自主进化（无人审）时抛出。
 * bash/write/edit 的参数直接影响权限边界行为，须人审。
 */
export class DestructiveAutoEvolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestructiveAutoEvolveError";
  }
}

// ── FloorGuard（REFACTOR：下限守卫泛化） ────────────────────────────────────

/**
 * 泛化下限守卫（spec §L1-T10 REFACTOR）。
 * 供未来参数基质（如 reducer 行数下限、partition 块下限）复用。
 */
export interface FloorGuard {
  readonly metric: string;
  readonly floor: number;
}

/** 泛化下限判定：值 < floor → throw。 */
function assertFloor(value: number, guard: FloorGuard): void {
  if (value < guard.floor) {
    throw new LimitFloorError(
      `${guard.metric}=${value} below floor ${guard.floor} (static-core lower bound)`,
    );
  }
}

const MAX_BYTES_GUARD: FloorGuard = {
  metric: "maxBytes",
  floor: LIMITS.maxBytesFloor,
};
const TIMEOUT_MS_GUARD: FloorGuard = {
  metric: "timeoutMs",
  floor: LIMITS.timeoutMsFloor,
};

// ── ToolTruncationTimeout ───────────────────────────────────────────────────

/**
 * per-tool maxLines/maxBytes + timeout 进化 driver + 三守卫。
 *
 * - `evolve`：读 per-tool 输出分布 + 重读率信号 → 产候选：
 *   重读率高的工具放大 maxBytes（×1.2，P95×1.2 启发式），从未填满的收紧
 *   （×0.9，但 ≥ floor）。破坏性工具不自主进化（须人审）。
 * - `assertLimits`：maxBytes/timeout 下限守卫（commit 前跑）。
 * - `assertErrorOutputNotHead`：错误类输出禁 head 守卫。
 * - `assertDestructiveHumanGated`：破坏性工具自主进化守卫。
 */
export class ToolTruncationTimeout {
  /**
   * 进化 per-tool 截断 + timeout 配置。
   *
   * - 重读率高（> 0.5）→ 放大 maxBytes（×1.2）：丢信息多，需保留更多。
   * - 重读率低 → 收紧 maxBytes（×0.9，但 ≥ floor）：从未填满，可省 token。
   * - timeout 暂不自动调整（信号维度不足，留人审；仅保留下限守卫）。
   * - 破坏性工具（bash/write/edit）不自主进化：保留原参数（须人审，
   *   `assertDestructiveHumanGated` 在自主路径抛错；此处对破坏性工具
   *   透传原 config 不进化）。
   * - 所有候选 commit 前跑 `assertLimits`。
   *
   * 返回新 config（不原地改）。
   */
  evolve(
    trunc: readonly TruncationConfig[],
    timeout: readonly TimeoutConfig[],
    signals: readonly TruncationSignal[],
  ): { trunc: TruncationConfig[]; timeout: TimeoutConfig[] } {
    const sigByTool = new Map<string, TruncationSignal>();
    for (const s of signals) sigByTool.set(s.tool, s);

    const newTrunc: TruncationConfig[] = trunc.map((t) => {
      // 破坏性工具不自主进化：保留原参数（人审路径才可改）。
      if ((DESTRUCTIVE_TOOLS as readonly string[]).includes(t.tool)) {
        return t;
      }
      const sig = sigByTool.get(t.tool);
      if (!sig) return t;

      let newMaxBytes = t.maxBytes;
      if (sig.rereadRate > 0.5) {
        // 重读率高 → 放大（丢信息多，需保留更多；P95×1.2 启发式）
        newMaxBytes = Math.floor(t.maxBytes * 1.2);
      } else {
        // 重读率低 → 收紧（从未填满，省 token；但 ≥ floor）
        newMaxBytes = Math.max(
          LIMITS.maxBytesFloor,
          Math.floor(t.maxBytes * 0.9),
        );
      }

      const candidate: TruncationConfig = Object.freeze({
        tool: t.tool,
        maxLines: t.maxLines,
        maxBytes: newMaxBytes,
        headTail: t.headTail,
      });
      // 下限守卫（commit 前跑）
      this.assertLimits(candidate);
      return candidate;
    });

    const newTimeout: TimeoutConfig[] = timeout.map((t) => {
      // timeout 暂不自动调整；仅保留下限守卫。
      this.assertLimits(t);
      return t;
    });

    return { trunc: newTrunc, timeout: newTimeout };
  }

  /**
   * 守卫：maxBytes/timeout 下限（static-core）。
   *
   * - `TruncationConfig` → `maxBytes` ≥ 1KB。
   * - `TimeoutConfig` → `timeoutMs` ≥ 1s。
   *
   * 突破下限 → throw `LimitFloorError`（防截断隐藏错误信息、防过短 timeout
   * 静默杀工具隐藏失败）。
   */
  assertLimits(c: TruncationConfig | TimeoutConfig): void {
    if ("maxBytes" in c) {
      assertFloor((c as TruncationConfig).maxBytes, MAX_BYTES_GUARD);
    } else if ("timeoutMs" in c) {
      assertFloor((c as TimeoutConfig).timeoutMs, TIMEOUT_MS_GUARD);
    }
  }

  /**
   * 守卫：错误类输出禁 head（错误在尾部，head 丢关键错误）。
   *
   * - 错误类工具 + `headTail==='head'` → throw `ErrorOutputHeadForbiddenError`。
   * - 错误类 + `tail` → 通过。
   * - 非错误类 → 通过（head/tail 均可）。
   */
  assertErrorOutputNotHead(
    c: TruncationConfig,
    isErrorClass: boolean,
  ): void {
    if (isErrorClass && c.headTail === "head") {
      throw new ErrorOutputHeadForbiddenError(
        `error-class tool '${c.tool}' must not use head truncation (errors live in tail; 02-tools-mcp comp3)`,
      );
    }
  }

  /**
   * 守卫：破坏性工具不自主进化（须人审）。
   *
   * - 破坏性工具（bash/write/edit）+ `isAutoEvolved===true` → throw
   *   `DestructiveAutoEvolvedError`（参数直接影响权限边界行为）。
   * - 破坏性工具 + 人审（isAutoEvolved=false）→ 通过。
   * - 非破坏性工具 → 通过（自主进化允许）。
   */
  assertDestructiveHumanGated(
    tool: string,
    isAutoEvolved: boolean,
  ): void {
    if (
      (DESTRUCTIVE_TOOLS as readonly string[]).includes(tool) &&
      isAutoEvolved
    ) {
      throw new DestructiveAutoEvolveError(
        `destructive tool '${tool}' must not be auto-evolved (human gate required; permission boundary params)`,
      );
    }
  }
}
