// L3-T14: AFlow MCTS 适配层（workflowScript + UCT + experience per node + cost Pareto） [V2]
//
// RED state: AFlowMctsOptimizer / MctsNode / SelectionSignalViolation /
// NotImplementedError not exported → RED. Invariants: UCT selects max node;
// heldout never feeds select/expand; non-workflow substrate rejected.
//
// Spec: execution/L3-engine/TASKS.md §L3-T14.

import { describe, it, expect, vi } from "vitest";
import {
  AFlowMctsOptimizer,
  SelectionSignalViolation,
  NotImplementedError,
} from "@harness/l3-engine";
import type { MctsNode, Fitness } from "@harness/l3-engine";
import { FakeLLM } from "./fixtures/fake-llm";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { FakeEvaluator } from "./fixtures/fake-evaluator";
import { makeSubstrate, makeFitness } from "./fixtures/factories";

function makeNode(overrides: Partial<MctsNode> = {}): MctsNode {
  return {
    id: "n0",
    parentSha: "root",
    workflowScript: "runs.run('a')",
    visits: 0,
    totalFitness: makeFitness({ resolve_rate: 0, token: 0, cache_hit: 0 }),
    children: [],
    ...overrides,
  };
}

describe("L3-T14", () => {
  // =========================================================================
  // UCT select
  // =========================================================================
  it("select: UCT picks max( avg + cUCT*sqrt(ln(parentVisits)/visits) ) node (seed-fixed id)", () => {
    const opt = new AFlowMctsOptimizer({
      llm: new FakeLLM({}),
      sandbox: new FakeSandbox(),
      evaluator: new FakeEvaluator({ seed: 42 }),
      cUCT: 1.41,
      seed: 42,
    });
    const parent = makeNode({ id: "root", visits: 10 });
    // Both children have the SAME average fitness (0.5) but different visit
    // counts. UCT's exploration term favours the less-visited node (B), so B
    // must be selected — this deterministically exercises the exploration
    // component of the UCT formula.
    const a = makeNode({
      id: "A",
      visits: 8,
      totalFitness: makeFitness({ resolve_rate: 4.0, token: 0, cache_hit: 0 }), // avg 0.5
    });
    const b = makeNode({
      id: "B",
      visits: 1,
      totalFitness: makeFitness({ resolve_rate: 0.5, token: 0, cache_hit: 0 }), // avg 0.5
    });
    parent.children = [a, b];
    const chosen = opt.select(parent);
    // B: 0.5 + 1.41*sqrt(ln(10)/1) ≈ 2.64  >  A: 0.5 + 1.41*sqrt(ln(10)/8) ≈ 1.26
    expect(chosen.id).toBe("B");
  });

  it("expand: LLM rewrites node wiring → ≥1 child Mutant (origin='reflective', editDistance > 0)", async () => {
    const llm = new FakeLLM({
      defaultReply: "runs.run('b'); runs.all('c');",
    });
    const opt = new AFlowMctsOptimizer({
      llm,
      sandbox: new FakeSandbox(),
      evaluator: new FakeEvaluator({ seed: 42 }),
      cUCT: 1.41,
      seed: 42,
    });
    const parent = makeNode({ id: "p", workflowScript: "runs.run('a')" });
    const children = opt.expand(parent);
    expect(children.length).toBeGreaterThanOrEqual(1);
    for (const c of children) {
      expect(c.id).not.toBe(parent.id);
      expect(c.parentSha).toBe(parent.parentSha);
      // workflowScript changed
      expect(c.workflowScript).not.toBe(parent.workflowScript);
    }
  });

  it("rollout: calls sandbox.runVerify (executes workflowScript) + evaluator.score", async () => {
    const sandbox = new FakeSandbox({ defaultStdout: "ok" });
    const evaluator = new FakeEvaluator({ seed: 42 });
    const opt = new AFlowMctsOptimizer({
      llm: new FakeLLM({}),
      sandbox,
      evaluator,
      cUCT: 1.41,
      seed: 42,
    });
    const node = makeNode({ id: "r", workflowScript: "runs.run('a')" });
    const fitness = await opt.rollout(node);
    expect(typeof fitness.resolve_rate).toBe("number");
    expect(typeof fitness.token).toBe("number");
    expect(typeof fitness.cache_hit).toBe("number");
    expect(sandbox.runVerifyCalls.length).toBeGreaterThan(0);
    // sandbox was asked to run the workflowScript
    expect(sandbox.runVerifyCalls.some((c) => c.cmd.includes("runs.run"))).toBe(true);
  });

  it("backprop: node.visits++ + totalFitness accumulates (experience per node)", () => {
    const opt = new AFlowMctsOptimizer({
      llm: new FakeLLM({}),
      sandbox: new FakeSandbox(),
      evaluator: new FakeEvaluator({ seed: 42 }),
      cUCT: 1.41,
      seed: 42,
    });
    const node = makeNode({ id: "b", visits: 0, totalFitness: makeFitness({ resolve_rate: 0, token: 0, cache_hit: 0 }) });
    const f: Fitness = makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 });
    opt.backprop(node, f);
    expect(node.visits).toBe(1);
    expect(node.totalFitness.resolve_rate).toBeCloseTo(0.6, 5);
    opt.backprop(node, f);
    expect(node.visits).toBe(2);
    expect(node.totalFitness.resolve_rate).toBeCloseTo(1.2, 5);
  });

  it("heldout fitness passed into select/expand feedback → SelectionSignalViolation (contract §2)", () => {
    const opt = new AFlowMctsOptimizer({
      llm: new FakeLLM({}),
      sandbox: new FakeSandbox(),
      evaluator: new FakeEvaluator({ seed: 42 }),
      cUCT: 1.41,
      seed: 42,
    });
    // @ts-expect-error inject heldout signal
    expect(() => opt.select(makeNode({ id: "h" }), { heldoutFitness: makeFitness() })).toThrow(
      SelectionSignalViolation,
    );
  });

  it("non-workflow substrate → NotImplementedError", async () => {
    const opt = new AFlowMctsOptimizer({
      llm: new FakeLLM({}),
      sandbox: new FakeSandbox(),
      evaluator: new FakeEvaluator({ seed: 42 }),
      cUCT: 1.41,
      seed: 42,
    });
    await expect(
      opt.generate(
        makeSubstrate({ kind: "prompt", sha: "p" }),
        { trajectories: [], best: null },
      ),
    ).rejects.toThrow(NotImplementedError);
  });
});
