// L3-T14: WorkflowMutator — rewrites pi-dynamic-workflows node wiring.
//
// Spec: execution/L3-engine/TASKS.md §L3-T14.
//
// The search space is a pi `workflowScript`: node-wiring calls such as
// `runs.run('id')`, `runs.all('ids')`, `runs.lanes(...)`. The mutator
// produces ≥1 wiring variant per expansion. Two entry points:
//
//   - `mutateSync(script)` — deterministic, synchronous wiring rewrite used
//     by the sync `expand` step (the MCTS `expand(node): MctsNode[]`
//     contract is sync; awaiting an LLM there would violate the interface).
//     Produces a meaningfully different script (edit distance > 0) by
//     appending a fresh exploration lane and rotating the first node id.
//
//   - `propose(parent, feedback)` — async, LLM-driven wiring rewrite used by
//     the async `generate` loop where the LLMPort can be awaited. Honours
//     the held-out signal-leak guard (contract §2).
//
// The breaker clause (eval/exec/network) is NOT re-checked here: workflow
// scripts run inside the Sandbox (T01) which already enforces static-core +
// breaker invariants. This module only shapes wiring text.

import type { LLMPort } from "../reflective-mutation.js";
import type { MctsNode } from "./mcts-tree.js";
import { zeroFitness } from "./mcts-tree.js";
import { SelectionSignalViolation } from "../beam-search.js";

/** Optional feedback bundle passed to expand/propose (held-out leak guard). */
export interface ExpandFeedback {
  /**
   * Held-out fitness. MUST NEVER be present — feeding held-out fitness into
   * expand/select is a contract §2 signal leak (canary overfit). Presence
   * raises `SelectionSignalViolation`.
   */
  heldoutFitness?: unknown;
}

/** Assert the feedback bundle carries no held-out signal (contract §2). */
export function assertNoHeldoutSignal(
  feedback: ExpandFeedback | undefined,
  where: string,
): void {
  if (feedback && feedback.heldoutFitness !== undefined) {
    throw new SelectionSignalViolation(
      `L3-T14: held-out fitness leaked into ${where} — contract §2 violation`,
    );
  }
}

/**
 * Extract the first node id literal from a `runs.run('id')` / `runs.all('id')`
 * call. Used to rotate wiring deterministically. Returns `null` when no
 * quoted id is found.
 */
function firstNodeId(script: string): string | null {
  const m = script.match(/runs\.(?:run|all)\(\s*['"]([^'"]+)['"]/);
  return m ? (m[1] ?? null) : null;
}

/** Append a fresh exploration lane, deterministic by counter. */
function appendLane(script: string, counter: number): string {
  const lane = `runs.all('explore-${counter}');`;
  return script.trimEnd().endsWith(";")
    ? `${script.trimEnd()}\n${lane}`
    : `${script.trimEnd()};\n${lane}`;
}

export class WorkflowMutator {
  private readonly llm: LLMPort;
  private readonly seed: number;
  private counter = 0;

  constructor(opts: { llm: LLMPort; seed: number }) {
    this.llm = opts.llm;
    this.seed = opts.seed;
  }

  /**
   * Synchronous deterministic wiring rewrite for the MCTS `expand` step.
   * Returns ≥1 variant whose `workflowScript` differs from the parent
   * (edit distance > 0). The LLM is NOT awaited here — the sync `expand`
   * contract forbids it; LLM-driven rewrites happen via `propose` in the
   * async `generate` loop.
   */
  mutateSync(parent: MctsNode, nextId: (p: string) => string): MctsNode[] {
    const base = parent.workflowScript;
    const child1Script = appendLane(base, ++this.counter);
    const child2Script = rotateFirstNode(base) ?? child1Script;
    const make = (script: string): MctsNode => ({
      id: nextId("n"),
      parentSha: parent.parentSha,
      workflowScript: script,
      visits: 0,
      totalFitness: zeroFitness(),
      children: [],
    });
    const out = [make(child1Script)];
    if (child2Script !== child1Script) out.push(make(child2Script));
    return out;
  }

  /**
   * Async LLM-driven wiring rewrite for the `generate` loop. Asks the LLM to
   * propose a new node-wiring script; falls back to `mutateSync` when the
   * LLM returns empty or an unchanged script.
   */
  async propose(
    parent: MctsNode,
    feedback: ExpandFeedback | undefined,
    nextId: (p: string) => string,
  ): Promise<MctsNode[]> {
    assertNoHeldoutSignal(feedback, "WorkflowMutator.propose");
    const prompt =
      `You are an AFlow workflow optimizer. Rewrite the following pi ` +
      `workflowScript node wiring to improve task resolve_rate while ` +
      `holding token cost. Return ONLY a new workflowScript.\n` +
      `Current:\n${parent.workflowScript}\n`;
    let reply = "";
    try {
      reply = (await this.llm.complete(prompt)).trim();
    } catch {
      reply = "";
    }
    if (reply && reply !== parent.workflowScript) {
      return [
        {
          id: nextId("n"),
          parentSha: parent.parentSha,
          workflowScript: reply,
          visits: 0,
          totalFitness: zeroFitness(),
          children: [],
        },
      ];
    }
    return this.mutateSync(parent, nextId);
  }
}

/** Rotate the first `runs.*('id')` node id literal (a → b, b → a, …). */
function rotateFirstNode(script: string): string | null {
  const id = firstNodeId(script);
  if (!id) return null;
  const next = id === "a" ? "b" : id === "b" ? "c" : "a";
  return script.replace(
    /(runs\.(?:run|all)\(\s*['"])([^'"]+)(['"])/,
    `$1${next}$3`,
  );
}
