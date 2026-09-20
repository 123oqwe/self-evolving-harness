// CE-T06 落地：canary 发布管线 v0 — shadow 5% + 退化信号自动 revert（rainbow 模式）。
//
// 行为（spec execution/canary-eval/TASKS.md §CE-T06）：
//   - 过门 variant 先进 canary（shadow 5%），观察窗口内采集退化信号；
//   - 退化信号（resolveRate 降 / cost 升 / PII>0 / 帕累托劣化）→ decision='AUTO_REVERT'
//     + revertCmd 执行 `git checkout <baselineSha> -- packages/l1-config/`；
//   - 无退化信号 → decision='PROMOTE'，revertCmd=null。
//
// ERRATA-w2plus 裁决（CE-T06）：
//   - canaryRelease 五参 `(variantSha, baselineSha, policy, observations, opts?)`；
//     `opts.baselineResolveRate` 注入，`drop = baseline - current`。
//   - shadow 5% 的“观察”= 把 observations 作为观察窗口终态注入（不实现真实流量采样）。
//   - “reject runtime mutation of revert thresholds”由 L0C pre-commit/breaker 守卫
//     （CE 侧不实现）；CE 侧仅守 `isRevertMechanismStaticCore()===true` 不变量 +
//     `canaryRelease` 不 mutate 传入的 policy 对象。
//
// 来源：PRD §6.4 + research/02-telemetry-eval-engine §4.5（Anthropic rainbow +
// DGM keep-all variants for revert）；复用 bigpowers reset-baseline 对照基线隔离。

import { buildRevertCmd } from "./revert.js";

/** 发布策略（shadow 比例 / 观察窗口 / revert 阈值 / rainbow 并行变体数）。 */
export interface ReleasePolicy {
  shadowPercent: 0.05;
  observationWindowTurns: number;
  revertThresholds: {
    resolveRateDrop: number;
    costRise: number;
    piiCount: number;
    paretoDominated: boolean;
  };
  rainbowParallelVariants: number;
}

/** canary 发布事件（裁决 + 可选 revert 命令）。 */
export interface ReleaseEvent {
  variantSha: string;
  baselineSha: string;
  shadow: 0.05;
  decision: "PROMOTE" | "AUTO_REVERT";
  // revertCmd 形如 `git checkout <baselineSha> -- packages/l1-config/`（spec 字面量为
  // 形状占位，实际 baselineSha 在运行时注入，故为 string | null）。
  revertCmd: string | null;
}

/**
 * 观察窗口内采集的退化信号（由调用方 / telemetry 注入，使退化判定可计算、可注入测试）。
 * shadow 5% 的“观察”= 把 observations 作为观察窗口终态注入（ERRATA-w2plus CE-T06）。
 */
export interface CanaryObservations {
  resolveRate: number; // 完成率
  cost: number; // 成本
  piiCount: number; // PII 命中数
  paretoDominated: boolean; // 帕累托劣化
}

/** canaryRelease 选项（注入 baselineResolveRate 作为退化判定对照基线，manifest 无此字段）。 */
export interface CanaryReleaseOptions {
  baselineResolveRate?: number;
}

/**
 * 判定观察窗口终态是否触发退化信号。
 *
 * - resolveRate 降：`drop = baselineResolveRate - observations.resolveRate`，
 *   `drop >= revertThresholds.resolveRateDrop` → 退化。
 * - PII 命中：`observations.piiCount >= revertThresholds.piiCount` → 退化。
 * - 帕累托劣化：`observations.paretoDominated === true && revertThresholds.paretoDominated === true` → 退化。
 * - cost 升：当前 opts 仅注入 baselineResolveRate（无 baseline cost），暂不可计算，
 *   保留阈值字段以备集成阶段注入 baseline cost。
 */
function detectDegradation(
  policy: ReleasePolicy,
  observations: CanaryObservations,
  opts?: CanaryReleaseOptions,
): boolean {
  const { revertThresholds } = policy;

  // resolveRate 降（drop = baseline - current）。
  if (opts?.baselineResolveRate !== undefined) {
    const drop = opts.baselineResolveRate - observations.resolveRate;
    if (drop >= revertThresholds.resolveRateDrop) {
      return true;
    }
  }

  // PII 命中数超阈值（threshold = 允许上限；observed > threshold 才算违规。
  // threshold=0 + observed=0 = 合规，不算退化——否则任何零 PII canary 都被误判
  // 退化，与 XM-T01 PROMOTE_POLICY.piiCount=0 + GOOD_OBS.piiCount=0 冲突）。
  if (observations.piiCount > revertThresholds.piiCount) {
    return true;
  }

  // 帕累托劣化（阈值开关为 true 时才生效）。
  if (revertThresholds.paretoDominated && observations.paretoDominated) {
    return true;
  }

  return false;
}

/**
 * canary 发布管线编排：在 shadow 5% 上观察 observations 终态，
 * 退化信号触发 AUTO_REVERT + revertCmd；否则 PROMOTE。
 *
 * 不变量：不 mutate 传入的 policy 对象（阈值不可被运行时篡改）。
 */
export async function canaryRelease(
  variantSha: string,
  baselineSha: string,
  policy: ReleasePolicy,
  observations: CanaryObservations,
  opts?: CanaryReleaseOptions,
): Promise<ReleaseEvent> {
  const degraded = detectDegradation(policy, observations, opts);

  if (degraded) {
    return {
      variantSha,
      baselineSha,
      shadow: policy.shadowPercent,
      decision: "AUTO_REVERT",
      revertCmd: buildRevertCmd(baselineSha),
    };
  }

  return {
    variantSha,
    baselineSha,
    shadow: policy.shadowPercent,
    decision: "PROMOTE",
    revertCmd: null,
  };
}

/**
 * 不变量：revert 机制本体是 static-core，agent 运行时不可改写。
 * （runtime mutation of revert thresholds 由 L0C pre-commit/breaker 守卫，CE 侧仅守此不变量。）
 */
export function isRevertMechanismStaticCore(): true {
  return true;
}
