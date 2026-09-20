// L3 test fixture — FakeEvaluator.
//
// Spec: execution/L3-engine/TASKS.md §L3-T02 (created here, reused T03-T09,
// T10-T14). Deterministic Fitness producer for the resolve_rate ∧ token ∧
// cache_hit triple. Pure function + fixed seed; no randomness leakage.
//
// Supports three fitness sources (priority high→low):
//   1. `throwOn` ids → score() throws (T02 score-failure isolation).
//   2. `table[id]` (per-split override via heldoutTable) → explicit Fitness.
//   3. `sequence[]` → Fitness served in call order (integration §1: 1st
//      improve, 2nd regress).
//   4. derive(id) → mulberry32(hashStr(id:seed)) fallback.
//
// Type-only imports from @harness/l3-engine are erased at transpile time, so
// this fixture loads even in RED (module placeholder). Concrete behaviour is
// self-contained.

import type { Evaluator, Fitness, Mutant } from "@harness/l3-engine";
import type { VerifierRun } from "@harness/canary-eval";
import { mulberry32, hashStr } from "./prng";

export interface FakeEvaluatorOptions {
  seed?: number;
  /** id → Fitness (train split). */
  table?: Record<string, Fitness>;
  /** id → Fitness override for heldout split. */
  heldoutTable?: Record<string, Fitness>;
  /** Fitness served in score-call order (ignores id). */
  sequence?: Fitness[];
  /** ids whose score() should throw (score-failure isolation path). */
  throwOn?: string[];
}

export interface ScoreCall {
  id: string;
  split: "train" | "heldout";
}

export class FakeEvaluator implements Evaluator {
  readonly seed: number;
  private readonly table: Map<string, Fitness>;
  private readonly heldoutTable: Map<string, Fitness>;
  private readonly sequence: Fitness[];
  private readonly throwOn: Set<string>;
  private seqIdx = 0;
  public calls: ScoreCall[] = [];

  constructor(opts: FakeEvaluatorOptions = {}) {
    this.seed = opts.seed ?? 42;
    this.table = new Map(Object.entries(opts.table ?? {}));
    this.heldoutTable = new Map(Object.entries(opts.heldoutTable ?? {}));
    this.sequence = opts.sequence ?? [];
    this.throwOn = new Set(opts.throwOn ?? []);
  }

  async score(m: Mutant, split: "train" | "heldout"): Promise<Fitness> {
    this.calls.push({ id: m.id, split });
    if (this.throwOn.has(m.id)) {
      throw new Error(`FakeEvaluator: forced score failure for ${m.id}`);
    }
    if (this.sequence.length && this.seqIdx < this.sequence.length) {
      return { ...this.sequence[this.seqIdx++] };
    }
    const src =
      split === "heldout" && this.heldoutTable.size > 0
        ? this.heldoutTable
        : this.table;
    const f = src.get(m.id) ?? this.derive(m.id);
    return { ...f };
  }

  /**
   * CE-T07 fresh-evidence 通道。fixture 产出 ≥1 条机械 VerifierRun
   * （exitCode=0 裁决），使 L3 select 步的 assertFreshEvidence 门放行——
   * 证明 commit 由机械证据背书，而非裸 Fitness fail-open。runId 每次唯一
   * （调序计数器），避免跨 run 合并歧义。真实生产 evaluator 须由真实
   * verify 命令产出 exitCode；此处 fixture 以 exitCode 0 模拟通过裁决。
   */
  async evidence(_m: Mutant): Promise<VerifierRun[]> {
    const idx = this.seqIdx; // 复用 score 调序，使 runId 与 score 对齐
    return [
      {
        taskId: `fake-${idx}`,
        command: "exit 0",
        exitCode: 0,
        stdout: "",
        stderr: "",
        runId: `fake-run-${idx}-${this.seed}`,
        contiguousRun: true,
        epermHits: [],
      },
    ];
  }

  /** Deterministic Fitness fallback from id+seed (mulberry32). */
  private derive(id: string): Fitness {
    const r = mulberry32(hashStr(`${id}:${this.seed}`));
    return {
      resolve_rate: Number(r().toFixed(3)),
      token: Math.floor(r() * 1000),
      cache_hit: Number(r().toFixed(3)),
    };
  }
}

/**
 * SEED_FIXTURE for the module-level integration test (§1).
 * Sequence: 1st variant improves, 2nd variant regresses (resolve_rate -10pp).
 * τ = {0,0,0} → the 2nd variant is rejected by strict-improvement.
 */
export const SEED_FIXTURE: FakeEvaluatorOptions = {
  seed: 42,
  sequence: [
    { resolve_rate: 0.6, token: 100, cache_hit: 0.5 }, // improve vs baseline 0.5/100/0.5
    { resolve_rate: 0.4, token: 200, cache_hit: 0.5 }, // regress (resolve_rate -0.10)
  ],
};

/** Baseline fitness used across multiple test files (resolve_rate 0.5). */
export const BASELINE_FITNESS: Fitness = {
  resolve_rate: 0.5,
  token: 100,
  cache_hit: 0.5,
};
