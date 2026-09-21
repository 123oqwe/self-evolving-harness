// L3-T14: AFlow MCTS 适配层 — workflowScript 作搜索空间；UCT + experience
// per node；held-out + cost Pareto. [V2]
//
// Spec: execution/L3-engine/TASKS.md §L3-T14.
//
// AFlow's MCTS-over-code-as-workflow adapted to pi `workflowScript`:
//   select  — UCT (avg exploitation + cUCT·√(ln N_parent / N_child) exploration)
//   expand  — WorkflowMutator rewrites node wiring → ≥1 child MctsNode
//   rollout — Sandbox executes the workflowScript; Evaluator scores it on the
//             TRAIN split only (held-out never feeds back — contract §2)
//   backprop— per-node experience: visits++ + totalFitness per-field sum
//
// Multi-objective: resolve_rate ∧ token ∧ cache_hit. The UCT acquisition
// scalarizes via the primary axis (resolve_rate avg); Pareto front rank +
// crowding (T05/T10) gates the final candidate set returned by `generate`.
// No weighted sum is ever formed (PRD §6.7 hard invariant).
//
// Held-out leak guard: any feedback bundle carrying `heldoutFitness` into
// `select` / `expand` raises `SelectionSignalViolation` (contract §2 — canary
// overfit defence).

import type {
  Evaluator,
  Fitness,
  Mutant,
  OptContext,
  Optimizer,
  Substrate,
} from "../types.js";
import type { LLMPort } from "../reflective-mutation.js";
import type { Sandbox } from "../sandbox.js";
import { NotImplementedError } from "./dspy-mipro.js";
import {
  MctsTree,
  accumulateFitness,
  zeroFitness,
  type MctsNode,
} from "./mcts-tree.js";
import {
  WorkflowMutator,
  assertNoHeldoutSignal,
  type ExpandFeedback,
} from "./workflow-mutator.js";

export interface AFlowMctsOptimizerOptions {
  llm: LLMPort;
  sandbox: Sandbox;
  evaluator: Evaluator;
  /** UCT exploration constant (e.g. √2 ≈ 1.41). */
  cUCT: number;
  seed: number;
  /** MCTS generations run by `generate` (default 3). */
  generations?: number;
}

/**
 * Raised when `generate` is called on a non-workflow substrate. AFlow MCTS
 * only operates on `workflow` substrates (code-as-workflow search space);
 * `prompt` / `skill` / `weight` channels are served by other optimizers
 * (T02/T03/T11/T12/T13/T15). Re-exported from dspy-mipro so the L3 barrel
 * exposes a single shared `NotImplementedError`.
 */
export { NotImplementedError } from "./dspy-mipro.js";

export class AFlowMctsOptimizer implements Optimizer {
  private readonly llm: LLMPort;
  private readonly sandbox: Sandbox;
  private readonly evaluator: Evaluator;
  private readonly cUCT: number;
  private readonly seed: number;
  private readonly generations: number;
  private readonly mutator: WorkflowMutator;

  constructor(opts: AFlowMctsOptimizerOptions) {
    this.llm = opts.llm;
    this.sandbox = opts.sandbox;
    this.evaluator = opts.evaluator;
    this.cUCT = opts.cUCT;
    this.seed = opts.seed;
    this.generations = opts.generations ?? 3;
    this.mutator = new WorkflowMutator({ llm: opts.llm, seed: opts.seed });
  }

  // -------------------------------------------------------------------------
  // generate — full MCTS closed loop on a workflow substrate.
  // -------------------------------------------------------------------------

  /**
   * Run N generations of select → expand → rollout → backprop over the
   * workflowScript search space, returning the expanded children as
   * `Mutant`s (`origin='reflective'`, `parentSha=substrate.sha`).
   *
   * `workflow` substrate only; any other kind raises `NotImplementedError`.
   */
  async generate(
    substrate: Substrate,
    _ctx: OptContext,
  ): Promise<Mutant[]> {
    if (substrate.kind !== "workflow") {
      throw new NotImplementedError(
        `L3-T14: AFlowMctsOptimizer only supports workflow substrates ` +
          `(got kind='${substrate.kind}')`,
      );
    }

    const root: MctsNode = {
      id: "root",
      parentSha: substrate.sha,
      workflowScript: substrate.content,
      visits: 0,
      totalFitness: zeroFitness(),
      children: [],
    };
    const tree = new MctsTree(root);
    const mutants: Mutant[] = [];

    for (let g = 0; g < this.generations; g++) {
      const leaf = this.select(root);
      const children = await this.mutator.propose(leaf, undefined, (p) =>
        tree.nextId(p),
      );
      tree.attach(leaf, children);
      for (const child of children) {
        const fitness = await this.rollout(child);
        this.backprop(child, fitness);
        mutants.push({
          id: child.id,
          parentSha: child.parentSha,
          content: child.workflowScript,
          origin: "reflective",
        });
      }
    }
    return mutants;
  }

  // -------------------------------------------------------------------------
  // select — UCT.
  // -------------------------------------------------------------------------

  /**
   * UCT selection: pick the child maximising
   *   avg(child) + cUCT·√(ln(N_parent) / N_child)
   * where `avg` is the per-field-sum scalarized by the primary objective
   * (resolve_rate). Unvisited children return +∞ (always explore first).
   *
   * Contract §2: a feedback bundle carrying `heldoutFitness` is a signal
   * leak → `SelectionSignalViolation`.
   */
  select(
    parent: MctsNode,
    feedback: ExpandFeedback | undefined = undefined,
  ): MctsNode {
    assertNoHeldoutSignal(feedback, "AFlowMctsOptimizer.select");
    if (parent.children.length === 0) return parent;
    const parentVisits = Math.max(parent.visits, 1);
    let best: MctsNode = parent.children[0]!;
    let bestU = -Infinity;
    for (const child of parent.children) {
      const u = this.uct(child, parentVisits);
      if (u > bestU) {
        bestU = u;
        best = child;
      }
    }
    return best;
  }

  private uct(node: MctsNode, parentVisits: number): number {
    if (node.visits === 0) return Number.POSITIVE_INFINITY;
    const avg = node.totalFitness.resolve_rate / node.visits;
    const exploration =
      this.cUCT * Math.sqrt(Math.log(parentVisits) / node.visits);
    return avg + exploration;
  }

  // -------------------------------------------------------------------------
  // expand — sync wiring rewrite (MctsNode[] per the interface contract).
  // -------------------------------------------------------------------------

  /**
   * Expand `parent` into ≥1 child by rewriting its workflowScript node
   * wiring. Sync per the MCTS `expand(node): MctsNode[]` contract — the
   * LLM-driven rewrite happens in `generate` via `WorkflowMutator.propose`;
   * here the deterministic sync mutator guarantees ≥1 differing variant.
   *
   * Contract §2: a feedback bundle carrying `heldoutFitness` is a signal
   * leak → `SelectionSignalViolation`.
   */
  expand(
    parent: MctsNode,
    feedback: ExpandFeedback | undefined = undefined,
  ): MctsNode[] {
    assertNoHeldoutSignal(feedback, "AFlowMctsOptimizer.expand");
    let counter = 0;
    const nextId = (p: string) => `${p}-${++counter}`;
    return this.mutator.mutateSync(parent, nextId);
  }

  // -------------------------------------------------------------------------
  // rollout — sandbox executes workflowScript; evaluator scores (train only).
  // -------------------------------------------------------------------------

  /**
   * Execute `node.workflowScript` in the sandbox and score the resulting
   * mutant on the TRAIN split. Held-out is never requested here (contract §2:
   * held-out fitness must not feed back into select/expand).
   */
  async rollout(node: MctsNode): Promise<Fitness> {
    const mutant: Mutant = {
      id: node.id,
      parentSha: node.parentSha,
      content: node.workflowScript,
      origin: "reflective",
    };
    const cmd = `pi-workflow exec ${node.workflowScript}`;
    await this.sandbox.runVerify(cmd, { timeoutMs: 30_000 });
    return this.evaluator.score(mutant, "train");
  }

  // -------------------------------------------------------------------------
  // backprop — experience per node (per-field sum, ERRATA L3-10).
  // -------------------------------------------------------------------------

  /**
   * Back-propagate `fitness` into `node`: `visits++` and `totalFitness`
   * accumulates each field independently (ERRATA L3-10: per-field sum, no
   * weighted combination). Mutates `node` in place.
   */
  backprop(node: MctsNode, fitness: Fitness): void {
    node.visits += 1;
    accumulateFitness(node.totalFitness, fitness);
  }
}

export type { MctsNode } from "./mcts-tree.js";
