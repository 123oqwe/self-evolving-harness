// L3-engine · package entry.
//
// L3-T01: core types, Sandbox port + STATIC_CORE_PATHS, breaker clause,
// optimizer router, and the `runEvolutionLoop` entry (breaker gate only;
// the generate → score → select → retain → canary body lands in T02–T09).

// Core contract types.
export type {
  SubstrateKind,
  Substrate,
  MutantOrigin,
  Mutant,
  Fitness,
  ParetoPoint,
  ArchiveStatus,
  ArchiveEntry,
  Trajectory,
  OptContext,
  Optimizer,
  Evaluator,
  LoopOptions,
  LoopResult,
} from "./types.js";

// Sandbox port + shared static-core constant.
export type { SecurityEvent, VerifyResult, Sandbox } from "./sandbox.js";
export { STATIC_CORE_PATHS } from "./sandbox.js";

// Breaker clause.
export { BreakerError, NotImplemented, recordSecurityEvent } from "./breaker.js";

// Optimizer router.
export { routeOptimizer } from "./optimizer-router.js";

// L3-T04: strict-improvement hard gate.
export { StrictImprovementGate, IncompleteFitness } from "./strict-improvement.js";
export type { Decision } from "./strict-improvement.js";

// ---------------------------------------------------------------------------
// L3-T09: EvolveSkillAdapter + FitnessBridge + runEvolutionLoop body +
// runEvolutionCycle (XM-T01 entry). Barrel additions only.
// ---------------------------------------------------------------------------

// FitnessBridge — telemetry → Fitness generalisation + error classes.
export {
  FitnessBridge,
  IncompleteTelemetry,
  FitnessGeneralizationError,
} from "./adapters/fitness-bridge.js";
export type { TelemetrySpan } from "./adapters/fitness-bridge.js";

// EvolveSkillAdapter + runEvolutionLoop (closed-loop body).
export { EvolveSkillAdapter, runEvolutionLoop } from "./adapters/evolve-skill-adapter.js";

// runEvolutionCycle (XM-T01 E2E entry) + E2E contract types.
export { runEvolutionCycle } from "./adapters/e2e-adapter.js";
export type {
  E2EConfig,
  CycleResult,
  MiniCanaryTask,
  MutationSource,
  ReleasePolicy,
  CanaryObservations,
  ReleaseEvent,
} from "./adapters/e2e-adapter.js";
