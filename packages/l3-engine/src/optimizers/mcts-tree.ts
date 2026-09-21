// L3-T14: MCTS tree node + experience-per-node bookkeeping.
//
// Spec: execution/L3-engine/TASKS.md §L3-T14.
//
// AFlow adapts MCTS-over-code-as-workflow: each node carries a pi
// `workflowScript` (`runs.run` / `runs.all` / `runs.lanes` node wiring) plus
// accumulated `experience` = `{ visits, totalFitness }`. The experience is
// per-node (not a global table): `backprop` mutates the node in place,
// summing each Fitness field independently (ERRATA L3-10: per-field sum).
//
// This module is intentionally tiny — it only owns the node shape and a
// minimal tree helper. The UCT select / expand / rollout / backprop drivers
// live in `aflow-mcts.ts`; the wiring rewrite lives in `workflow-mutator.ts`.
// A future release may persist experience via `mcts-store.ts` (REFACTOR hint
// in the spec); the in-memory `MctsNode` shape is the stable contract.

import type { Fitness } from "../types.js";

/**
 * A Monte-Carlo Tree Search node for AFlow.
 *
 * `workflowScript` is the pi-dynamic-workflows node-wiring script (the
 * "code-as-workflow" search space). `totalFitness` accumulates the per-field
 * sum of every `rollout` result back-propagated through this node; `visits`
 * is the count. `children` are the expanded wiring variants.
 */
export interface MctsNode {
  id: string;
  /** sha of the substrate / parent node this variant descends from. */
  parentSha: string;
  workflowScript: string;
  visits: number;
  /** Per-field accumulated fitness (experience per node, ERRATA L3-10). */
  totalFitness: Fitness;
  children: MctsNode[];
}

/** Zero fitness accumulator used to seed fresh nodes. */
export function zeroFitness(): Fitness {
  return { resolve_rate: 0, token: 0, cache_hit: 0 };
}

/**
 * Per-field sum of `b` into `a` (mutates `a`). ERRATA L3-10: each Fitness
 * dimension accumulates independently — there is no weighted sum (PRD §6.7
 * hard invariant; multi-objective acquisition is handled by the caller's
 * scalarization, never by mixing fields here).
 */
export function accumulateFitness(a: Fitness, b: Fitness): void {
  a.resolve_rate += b.resolve_rate;
  a.token += b.token;
  a.cache_hit += b.cache_hit;
}

/**
 * Minimal in-memory MCTS tree. Keeps a root reference and a monotonic id
 * counter for expanded children. `size()` is the total node count (used by
 * the keep-all / experience-grows invariant guard shared with T06a).
 */
export class MctsTree {
  readonly root: MctsNode;
  private counter = 0;
  private _size = 1;

  constructor(root: MctsNode) {
    this.root = root;
  }

  size(): number {
    return this._size;
  }

  /** Mint a fresh child node id (deterministic, monotonic). */
  nextId(prefix = "n"): string {
    return `${prefix}-${++this.counter}`;
  }

  /** Attach `children` to `parent` and grow the size counter. */
  attach(parent: MctsNode, children: MctsNode[]): void {
    for (const c of children) {
      parent.children.push(c);
      this._size++;
    }
  }
}
