// L3-engine · core types.
//
// Spec: execution/L3-engine/TASKS.md §0 (包布局) + §2 (跨模块接口契约) +
// §L3-T01 (接口签名). These are the cross-module contract types consumed by
// the optimizer, evaluator, archive, retain, and the evolution loop entry.
//
// Only `export type` + `export interface`. No mutable singletons.

// ---------------------------------------------------------------------------
// Substrate (the artefact being evolved)
// ---------------------------------------------------------------------------

export type SubstrateKind = "prompt" | "workflow" | "skill" | "weight";

export interface Substrate {
  kind: SubstrateKind;
  content: string;
  sha: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mutant (a candidate variant produced by an optimizer)
// ---------------------------------------------------------------------------

export type MutantOrigin = "beam-search" | "reflective" | "archive";

export interface Mutant {
  id: string;
  parentSha: string;
  content: string;
  origin: MutantOrigin;
}

// ---------------------------------------------------------------------------
// Fitness (multi-objective: resolve_rate ∧ token ∧ cache_hit, NO weighted sum)
// ---------------------------------------------------------------------------

export interface Fitness {
  resolve_rate: number;
  token: number;
  cache_hit: number;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pareto + Archive entries
// ---------------------------------------------------------------------------

export interface ParetoPoint {
  mutant: Mutant;
  fitness: Fitness;
}

export type ArchiveStatus = "active" | "retired";

export interface ArchiveEntry {
  sha: string;
  parentSha: string | null;
  mutant: Mutant;
  fitness: Fitness;
  generation: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Trajectory (failure feed, CE-T03 Lucky-Pass filtered; §2 TrajectoryFeed)
// ---------------------------------------------------------------------------

export interface Trajectory {
  id: string;
  sessionId: string;
  substrateSha: string;
  failed: true;
  diagnosis: string;
  luckyPass?: boolean;
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Optimizer + Evaluator ports
// ---------------------------------------------------------------------------

export interface OptContext {
  best: Mutant | null;
  trajectories?: Trajectory[];
}

export interface Optimizer {
  generate(substrate: Substrate, ctx: OptContext): Promise<Mutant[]>;
}

export interface Evaluator {
  score(m: Mutant, split: "train" | "heldout"): Promise<Fitness>;
}

// ---------------------------------------------------------------------------
// Evolution loop options + result (entry contract, §L3-T01)
// ---------------------------------------------------------------------------

export interface LoopOptions {
  substrate: Substrate;
  beamWidth: number;
  evaluator: Evaluator;
  sandbox: import("./sandbox.js").Sandbox;
  tau: Partial<Record<keyof Fitness, number>>;
  generations: number;
}

export interface LoopResult {
  archive: { size(): number };
  rejected: Mutant[];
  committed?: { version: string; sha: string };
}
