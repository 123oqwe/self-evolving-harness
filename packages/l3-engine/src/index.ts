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
// L3-T05: Pareto multi-objective selector (resolve_rate ∧ token ∧ cache_hit,
// NO weighted sum — PRD §6.7 hard invariant). Barrel additions only.
// ---------------------------------------------------------------------------
export { ParetoSelector, WeightedSumForbidden } from "./pareto-selector.js";
export type { ParetoSelector as ParetoSelectorInterface } from "./pareto-selector.js";

// ---------------------------------------------------------------------------
// L3-T03: reflective mutation generator (GEPA variant source) + luckyPass
// defence-in-depth guard. Barrel additions only.
// ---------------------------------------------------------------------------
export {
  ReflectiveMutator,
  LuckyPassTrajectoryRejected,
  MalformedMutation,
} from "./reflective-mutation.js";
export type {
  LLMPort,
  ReflectiveMutatorOptions,
} from "./reflective-mutation.js";

// ---------------------------------------------------------------------------
// L3-T02: GEPA-reduced beam-search optimizer + FakeEvaluator fixture deps.
// Barrel additions only (REFACTOR: PRNG抽 src/prng.ts 供 T06b reseed 复用).
// ---------------------------------------------------------------------------

// Deterministic PRNG helpers (shared with tests/L3/fixtures/prng.ts).
export { mulberry32, hashStr, seededPrng } from "./prng.js";

// BeamSearchOptimizer + ScoredMutant + SelectionSignalViolation.
export {
  BeamSearchOptimizer,
  SelectionSignalViolation,
  defaultDiversityMetric,
} from "./beam-search.js";
export type {
  ScoredMutant,
  BeamSearchOptimizerOptions,
} from "./beam-search.js";

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

// ---------------------------------------------------------------------------
// L3-T06a: DGM open-ended tree archive (keep-all variant; interesting =
// non-strictly-dominated). Barrel additions only.
// ---------------------------------------------------------------------------
export { TreeArchive, DuplicateArchiveEntry, ArchiveEntryNotFound } from "./archive/tree-archive.js";

// ---------------------------------------------------------------------------
// L3-T06b: FunSearch island reseed + MAP-Elites behavior bins (keep-all;
// reseed "kill" = retired, not delete; never-auto-delete invariant shared
// with T06a). Barrel additions only.
// ---------------------------------------------------------------------------
export {
  IslandArchive,
  MapElitesArchive,
} from "./archive/island-mapelites.js";
export type {
  IslandArchiveOptions,
  MapElitesOptions,
  ReseedResult,
} from "./archive/island-mapelites.js";

// ---------------------------------------------------------------------------
// L3-T07: ExpeL upvote/downvote importance counter (start 2; count==0 →
// retire, not delete; <minEvidence evidence → not activated). Barrel
// additions only.
// ---------------------------------------------------------------------------
export { ExpelCounter } from "./archive/expel-counter.js";
export type { ExpelCounterOptions } from "./archive/expel-counter.js";

// ---------------------------------------------------------------------------
// L3-T08: Voyager commit-on-success retain + auto-revert (canary shadow +
// regression-signal → CE-T06 git checkout). Barrel additions only.
// Static-core invariant: rollbackThreshold frozen; optimizer cannot mutate;
// revertExec delegates to CE-T06 (git checkout), not implemented in L3.
// ---------------------------------------------------------------------------
export { Retain, bumpVersion, baseName } from "./retain/commit-on-success.js";
export type {
  RetainGate,
  CommitResult,
  VectorIndex,
} from "./retain/commit-on-success.js";
export { AutoRevert } from "./retain/auto-revert.js";
export type {
  RegressionSignal,
  CanaryHandle,
  RevertResult,
  AutoRevertOptions,
} from "./retain/auto-revert.js";
export { buildRollbackCommand } from "./retain/git-client.js";

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

// ---------------------------------------------------------------------------
// L3-T10: full-population reflective mutation + NSGA-II non-dominated sort
// (GEPA 完整版升级, V1). Barrel additions only.
// ---------------------------------------------------------------------------
export {
  FullPopulationBeamSearch,
} from "./full-population-beam-search.js";
export type {
  ReflectivePort,
  FullPopulationBeamSearchOptions,
  FullPopulationContext,
} from "./full-population-beam-search.js";

export {
  FullParetoSelector,
} from "./full-pareto-selector.js";
export type { NSGAFront, FullParetoSelector as FullParetoSelectorInterface } from "./full-pareto-selector.js";

// ---------------------------------------------------------------------------
// L3-T11: DSPy/MIPROv2 instruction×demo factorize + mini-batch Bayesian
// surrogate (random-forest MVP) + train/val anti-overfit gate. Barrel
// additions only.
// ---------------------------------------------------------------------------
export {
  DspyMiproOptimizer,
  NotImplementedError,
} from "./optimizers/dspy-mipro.js";
export type { DspyMiproOptimizerOptions } from "./optimizers/dspy-mipro.js";
export {
  BayesianSurrogate,
  TrainValLeak,
} from "./optimizers/bayesian-surrogate.js";
export type {
  BayesianSurrogateOptions,
  SurrogateSample,
  SurrogatePrediction,
} from "./optimizers/bayesian-surrogate.js";
export { factorizeInstructionDemo } from "./optimizers/instruction-demo-factorize.js";
