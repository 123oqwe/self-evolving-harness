// evolve-core · 配置/结果类型（宿主无关收口）。
//
// Spec: execution/plugin/TASKS.md §PLG-T01（接口签名逐字对齐）。
//
// 所有宿主特定性收口到 `EvolveConfig.harnessPort`（任意插件包注入的
// HarnessPort）。本文件不复用 E2EConfig（E2EConfig 绑定 promptPath/workspaceDir
// 具体 repo 布局，非宿主无关）。

import type { HarnessPort } from "@harness/adapters";

/** canary 任务（CE-T01a CanaryTask minimal subset，对齐 E2EConfig.MiniCanaryTask）。 */
export interface EvolveCanaryTask {
  readonly id: string;
  readonly verify: string; // 机械 verify 命令（exit code 裁决）
  readonly expectedExit: number; // 默认 0
}

/** 插件工厂：harness id → HarnessPort + 基质 id（CLI registry 共用）。 */
export interface EvolvePluginFactory {
  readonly harnessId: string;
  create(opts: Record<string, unknown>): HarnessPort;
}

/** runEvolutionCycle 配置（宿主无关：所有宿主特定性收口到 harnessPort）。 */
export interface EvolveConfig {
  /** 注入的 HarnessPort（任意插件包提供：codex/opencode/hermes/...）。 */
  readonly harnessPort: HarnessPort;
  /** 被进化基质 id（readSubstrate/writeSubstrate/deploy 的 id）。 */
  readonly substrateId: string;
  /** canary 任务集（≥3，CE-T01a 形状；score 步 runVerify 产出 VerifierRun）。 */
  readonly canary: EvolveCanaryTask[];
  /** 进化代数（默认 1，对齐 XM-T01）。 */
  readonly generations?: number;
  /** held-out 退化阈值 τ（默认 resolve_rate 降 0 即触发 revert）。 */
  readonly tau?: Partial<Record<"resolve_rate" | "token" | "cache_hit", number>>;
  /** 离线模式标志（无轨迹 harness，如 Cursor）：true 则跳过 mine 步。 */
  readonly offline?: boolean;
  /** canary 发布策略（透传 CE-T06 ReleasePolicy minimal subset）。 */
  readonly canaryPolicy?: {
    readonly shadowPercent: number;
    readonly observationWindowTurns: number;
    readonly revertThresholds: {
      readonly resolveRateDrop: number;
      readonly costRise: number;
      readonly piiCount: number;
      readonly paretoDominated: boolean;
    };
  };
  /** 工作目录（git 版本化，deploy/rollback 落 git；默认 process.cwd）。 */
  readonly workspaceDir?: string;
}

/** runEvolutionCycle 结果（对齐 CycleResult 字段名，保留兼容）。 */
export interface EvolveResult {
  readonly retainedMutants: number;
  readonly committed: { readonly sha: string; readonly origin: string } | null;
  readonly canaryRelease:
    | { readonly decision: "PROMOTE" | "AUTO_REVERT" | "HOLD"; readonly variantSha: string }
    | null;
  readonly revertEvent:
    | { readonly decision: "PROMOTE" | "AUTO_REVERT" | "HOLD"; readonly variantSha: string }
    | null;
  readonly baselineResolveRate: number;
  readonly postRevertResolveRate: number;
  readonly retain: number;
  readonly offline: boolean;
}
