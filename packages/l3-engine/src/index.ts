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

// ---------------------------------------------------------------------------
// L3-T12: TextGrad per-variable 文本梯度适配 (reverse pass: failure →
// per-variable text gradient → isolated per-variable rewrite). Defining
// invariant vs L3-T03 reflective mutation: PER-VARIABLE ISOLATION (a
// gradient on variable A must never change variable B). Prompt/skill
// substrates only; weight channel → NotImplementedError (V2 placeholder).
// Barrel additions only.
// ---------------------------------------------------------------------------
export { TextGradOptimizer } from "./optimizers/textgrad.js";
export type {
  TextGradVariable,
  TextGrad,
  TextLoss,
  TextGradOptimizerOptions,
  TextGradContext,
} from "./optimizers/textgrad.js";
export {
  parseVariables,
  assembleContent,
  SEGMENT_SEPARATOR,
} from "./optimizers/variable-parser.js";

// ---------------------------------------------------------------------------
// L3-T13: ADAS meta-agent + growing archive + Turing-complete DSL [V1].
// AdasMetaSearchOptimizer: meta-agent reads growing archive (T06a keep-all)
// → few-shot samples high-fitness + high-diversity → writes new skill code
// (AgentDSL). Breaker clause (eval/exec/network) inherited from L2-T09b via
// the shared dsl-validator walker. Barrel additions only.
// ---------------------------------------------------------------------------
export { AdasMetaSearchOptimizer } from "./optimizers/adas-meta-search.js";
export type { AdasMetaSearchOptimizerOptions } from "./optimizers/adas-meta-search.js";
export { AgentDSL } from "./optimizers/agent-dsl.js";
export type { AST, ASTNode, AgentDSL as AgentDSLInterface } from "./optimizers/agent-dsl.js";
export { validateBreakerFlags } from "./optimizers/dsl-validator.js";
export type { DslValidationResult } from "./optimizers/dsl-validator.js";

// ---------------------------------------------------------------------------
// L3-T14: AFlow MCTS 适配层 [V2] — workflowScript 作搜索空间；UCT + experience
// per node；held-out + cost Pareto. Barrel additions only.
// ---------------------------------------------------------------------------
export { AFlowMctsOptimizer } from "./optimizers/aflow-mcts.js";
export type { AFlowMctsOptimizerOptions } from "./optimizers/aflow-mcts.js";
export type { MctsNode } from "./optimizers/mcts-tree.js";
export { MctsTree, zeroFitness, accumulateFitness } from "./optimizers/mcts-tree.js";
export { WorkflowMutator } from "./optimizers/workflow-mutator.js";

// ---------------------------------------------------------------------------
// L3-T15: 权重通道 gate (默认 off 不变量 + 四阈值) [V2]. 本任务不实现权重
// 训练，只提供不变量测试钩子：WEIGHT_CHANNEL_DEFAULT='off' (PRD §6.1 N1) +
// WeightChannelGate 四阈值 (KL_MAX / ORACLE_PASS_MIN / consolidation /
// humanSigned) + 运行时 off→on breaker. Barrel additions only.
// ---------------------------------------------------------------------------
export {
  WEIGHT_CHANNEL_DEFAULT,
  WeightChannelGate,
  KL_MAX,
  ORACLE_PASS_MIN,
  CONSOLIDATION_NONINFERIOR_REQUIRED,
  HUMAN_GATE_SIGNED_REQUIRED,
} from "./weight-channel-gate.js";
export type {
  WeightChannelPreconditions,
  WeightChannelGateResult,
  WeightChannelGateOptions,
} from "./weight-channel-gate.js";

// ---------------------------------------------------------------------------
// REAL-T01: RealLLMPort (pi headless) — 真实 LLM 调用 via `pi -p` 子进程.
// 实现 §L3-T03 的 `LLMPort`，供真实进化循环（REAL-T02/T03）与 ADP-T02
// PiHeadlessLLM 复用（adapters→l3-engine 单向依赖，不反向）。Barrel additions only.
// ---------------------------------------------------------------------------
export {
  RealLLMPort,
  PiHeadlessError,
  PiHeadlessTimeout,
  stripAnsi,
} from "./llm/pi-headless-port.js";
export type { RealLLMPortOptions } from "./llm/pi-headless-port.js";
