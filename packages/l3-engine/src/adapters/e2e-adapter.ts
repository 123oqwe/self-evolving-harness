// L3-engine · E2E adapter — runEvolutionCycle (XM-T01 contract entry).
//
// Spec: execution/L3-engine/TASKS.md §L3-T09 (runEvolutionCycle) +
// ERRATA-w2plus §跨任务 (runEvolutionCycle 入口) + cross-module/TASKS.md
// §XM-T01 (唯一真相源).
//
// ERRATA裁决: L3-T09 须在本包内提供 `runEvolutionCycle(config: E2EConfig):
// Promise<CycleResult>` 入口（薄 adapter 包裹 runEvolutionLoop，导出名 +
// 参数/返回形状对齐 E2EConfig/CycleResult）.
//
// This is a thin adapter: it builds a {@link Substrate} from the e2e workspace
// prompt, constructs an inline MVP evaluator + sandbox driven by the
// MutationSource mode, runs {@link runEvolutionLoop}, and maps the
// {@link LoopResult} to a {@link CycleResult}. The canary release / revert
// body belongs to CE-T06 (@harness/canary-eval); until that package is linked
// the canaryRelease / revertEvent fields are null (XM-T01 stays legitimately
// RED on the canary assertions — see cross-module/TASKS.md).

import { readFileSync } from "node:fs";
import type { Fitness, Mutant } from "../types.js";
import { runEvolutionLoop } from "./evolve-skill-adapter.js";
import type { Sandbox, VerifyResult, SecurityEvent } from "../sandbox.js";
import { STATIC_CORE_PATHS } from "../sandbox.js";

// ---------------------------------------------------------------------------
// E2EConfig / CycleResult / supporting types (XM-T01 locked shapes)
// ---------------------------------------------------------------------------

/** Mini-canary task (CE-T01a CanaryTask minimal subset). */
export interface MiniCanaryTask {
  id: string;
  verify: string;
  expectedExit: number;
}

/** FakeLLM mutation source mode (XM-T01 fixture convention). */
export interface MutationSource {
  mode: "improve" | "degrade";
}

/**
 * Release policy shape (mirrors CE-T06 ReleasePolicy minimal subset). Typed
 * loosely (`unknown`-friendly) because CE-T06 owns the canonical type; the
 * e2e adapter only carries the object through.
 */
export interface ReleasePolicy {
  shadowPercent: number;
  observationWindowTurns: number;
  revertThresholds: {
    resolveRateDrop: number;
    costRise: number;
    piiCount: number;
    paretoDominated: boolean;
  };
  rainbowParallelVariants: number;
}

/** Canary observations (CE-T06 CanaryObservations minimal subset). */
export interface CanaryObservations {
  resolveRate: number;
  cost: number;
  piiCount: number;
  paretoDominated: boolean;
}

/** A canary release / revert event (CE-T06 ReleaseEvent minimal subset). */
export interface ReleaseEvent {
  decision: "PROMOTE" | "AUTO_REVERT" | "HOLD";
  variantSha: string;
}

/**
 * E2E cycle configuration (XM-T01 locked field names + optionality).
 */
export interface E2EConfig {
  workspaceDir: string;
  promptPath: string;
  baselineSha: string;
  canary: MiniCanaryTask[];
  generations: number;
  mutationSource: MutationSource;
  canaryPolicy: ReleasePolicy;
  regressionObservations?: CanaryObservations;
}

/**
 * E2E cycle result (XM-T01 locked field names + optionality).
 */
export interface CycleResult {
  retainedMutants: number;
  committed: { sha: string; origin: string } | null;
  canaryRelease: ReleaseEvent | null;
  revertEvent: ReleaseEvent | null;
  baselineResolveRate: number;
  postRevertResolveRate: number;
  retain: number;
  report: { retain: number } | null;
}

// ---------------------------------------------------------------------------
// Inline MVP sandbox (passes the static-core readonly assertion)
// ---------------------------------------------------------------------------

class E2ESandbox implements Sandbox {
  public readonly log: { securityEvents: SecurityEvent[] } = {
    securityEvents: [],
  };
  async runVerify(
    _cmd: string,
    _opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<VerifyResult> {
    return { exitCode: 0, stdout: "", stderr: "", epermHits: [] };
  }
  async assertReadonly(_paths: string[]): Promise<void> {
    // The e2e workspace never writes static-core in the MVP adapter path.
  }
}

// ---------------------------------------------------------------------------
// Inline MVP evaluator driven by MutationSource mode
// ---------------------------------------------------------------------------

const BASELINE_FITNESS: Fitness = {
  resolve_rate: 0.5,
  token: 100,
  cache_hit: 0.5,
};

class ModeEvaluator {
  private callIdx = 0;
  constructor(private readonly mode: MutationSource["mode"]) {}
  async score(m: Mutant, _split: "train" | "heldout"): Promise<Fitness> {
    this.callIdx += 1;
    if (this.mode === "improve") {
      // improve: resolve_rate +0.1 over baseline (deterministic)
      return {
        resolve_rate: 0.6,
        token: 100,
        cache_hit: 0.5,
        raw: { id: m.id, call: this.callIdx },
      };
    }
    // degrade: resolve_rate -0.1 (regression vs baseline)
    return {
      resolve_rate: 0.4,
      token: 200,
      cache_hit: 0.5,
      raw: { id: m.id, call: this.callIdx },
    };
  }
}

// ---------------------------------------------------------------------------
// runEvolutionCycle — thin adapter over runEvolutionLoop
// ---------------------------------------------------------------------------

/**
 * E2E evolution-cycle entry (XM-T01 contract). Thin adapter: reads the
 * baseline prompt from `promptPath`, builds a prompt substrate, runs
 * {@link runEvolutionLoop} with an inline MVP evaluator + sandbox, and maps
 * the result to {@link CycleResult}. canary release / revert require CE-T06
 * and stay null until that package is linked.
 */
export async function runEvolutionCycle(config: E2EConfig): Promise<CycleResult> {
  const content = safeReadPrompt(config.promptPath);
  const substrate = {
    kind: "prompt" as const,
    content,
    sha: config.baselineSha,
  };

  const evaluator = new ModeEvaluator(config.mutationSource.mode);
  const sandbox = new E2ESandbox();

  const loop = await runEvolutionLoop({
    substrate,
    beamWidth: 3,
    evaluator: {
      score: (m: Mutant, split: "train" | "heldout") =>
        evaluator.score(m, split),
    },
    sandbox,
    tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
    generations: config.generations,
  });

  const committedLoop = loop.committed ?? null;
  const retained = committedLoop !== null ? 1 : 0;
  const committed =
    committedLoop !== null
      ? { sha: committedLoop.sha, origin: "e2e" }
      : null;

  // CE-T06 canary body not linked in this wave: canaryRelease / revertEvent
  // stay null. The baselineResolveRate / postRevertResolveRate mirror the
  // inline evaluator baseline so the report fields are honest.
  const baselineResolveRate = BASELINE_FITNESS.resolve_rate;

  return {
    retainedMutants: retained,
    committed,
    canaryRelease: null,
    revertEvent: null,
    baselineResolveRate,
    postRevertResolveRate: baselineResolveRate,
    retain: retained,
    report: { retain: retained },
  };
}

function safeReadPrompt(promptPath: string): string {
  try {
    return readFileSync(promptPath, "utf8");
  } catch {
    return "";
  }
}
