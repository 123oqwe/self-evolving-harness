// L3-T12: TextGrad per-variable 文本梯度 [V1]
//
// RED state: TextGradOptimizer / TextGradVariable / TextLoss / TextGrad /
// LuckyPassTrajectoryRejected / NotImplementedError not exported → RED.
// Key invariant: per-variable isolation (A's gradient must not change B).
//
// Spec: execution/L3-engine/TASKS.md §L3-T12.

import { describe, it, expect } from "vitest";
import {
  TextGradOptimizer,
  LuckyPassTrajectoryRejected,
  NotImplementedError,
} from "@harness/l3-engine";
import type { TextGradVariable, TextLoss, Substrate } from "@harness/l3-engine";
import { FakeLLM } from "./fixtures/fake-llm";
import { makeTrajectory } from "./fixtures/fake-trajectory";
import { makeSubstrate } from "./fixtures/factories";

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

describe("L3-T12", () => {
  it("backprop: 2 variables → each gets an independent gradient suggestion (FakeLLM routes by varId)", async () => {
    const llm = new FakeLLM({
      responder: (prompt: string) => {
        if (prompt.includes("instruction")) return "improve the instruction clarity";
        if (prompt.includes("demo")) return "rewrite the few-shot example";
        return "";
      },
    });
    const opt = new TextGradOptimizer({ llm, maxIterations: 1 });
    const loss: TextLoss = {
      trajectoryId: "traj-1",
      feedback: "failed to resolve",
    };
    const vars: TextGradVariable[] = [
      { id: "instruction", content: "You are a helpful agent.", role: "instruction" },
      { id: "demo", content: "Q: 1+1 A: 2", role: "demo" },
    ];
    const grads = opt.backprop(loss, vars);
    expect(grads).toHaveLength(2);
    const instrGrad = grads.find((g) => g.varId === "instruction");
    const demoGrad = grads.find((g) => g.varId === "demo");
    expect(instrGrad).toBeDefined();
    expect(demoGrad).toBeDefined();
    expect(instrGrad!.suggestion).not.toBe(demoGrad!.suggestion);
  });

  it("applyGradients: produced Mutant rewrites both variables (editDistance > 0 each)", async () => {
    const llm = new FakeLLM({
      responder: (p: string) =>
        p.includes("instruction") ? "clearer instruction v2" : "better demo v2",
    });
    const opt = new TextGradOptimizer({ llm, maxIterations: 1 });
    const loss: TextLoss = { trajectoryId: "t", feedback: "fail" };
    const vars: TextGradVariable[] = [
      { id: "instruction", content: "old-instr", role: "instruction" },
      { id: "demo", content: "old-demo", role: "demo" },
    ];
    const mutants = await opt.generate(
      makeSubstrate({ sha: "p", content: "old-instr\n---\nold-demo" }),
      { trajectories: [], best: null, loss },
    );
    expect(mutants.length).toBeGreaterThan(0);
    const m = mutants[0];
    // both variables changed
    expect(editDistance(m.content, "old-instr\n---\nold-demo")).toBeGreaterThan(0);
  });

  it("luckyPass trajectory → LuckyPassTrajectoryRejected (inherited from T03)", async () => {
    const opt = new TextGradOptimizer({
      llm: new FakeLLM({ defaultReply: "" }),
      maxIterations: 1,
    });
    const lucky = makeTrajectory({
      substrateSha: "p",
      luckyPass: true,
    });
    await expect(
      opt.generate(makeSubstrate({ sha: "p" }), {
        trajectories: [lucky],
        best: null,
        loss: { trajectoryId: lucky.id, feedback: "x" },
      }),
    ).rejects.toThrow(LuckyPassTrajectoryRejected);
  });

  it("empty-gradient variable stays unchanged (LLM gave no suggestion for it)", () => {
    const llm = new FakeLLM({
      responder: (p: string) =>
        p.includes("instruction") ? "fix instr" : "", // no suggestion for demo
    });
    const opt = new TextGradOptimizer({ llm, maxIterations: 1 });
    const vars: TextGradVariable[] = [
      { id: "instruction", content: "instr-old", role: "instruction" },
      { id: "demo", content: "demo-old", role: "demo" },
    ];
    const grads = opt.backprop(
      { trajectoryId: "t", feedback: "f" },
      vars,
    );
    const applied = opt.applyGradients(vars, grads);
    // instruction changed, demo unchanged
    expect(applied.content).toContain("demo-old");
  });

  it("weight substrate → NotImplementedError (prompt/skill only)", async () => {
    const opt = new TextGradOptimizer({
      llm: new FakeLLM({}),
      maxIterations: 1,
    });
    await expect(
      opt.generate(makeSubstrate({ kind: "weight", sha: "w" }), {
        trajectories: [],
        best: null,
        loss: { trajectoryId: "t", feedback: "f" },
      }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("per-variable isolation: A's gradient does not change B's content", () => {
    const llm = new FakeLLM({
      responder: (p: string) =>
        p.includes("instruction") ? "patched-instruction" : "",
    });
    const opt = new TextGradOptimizer({ llm, maxIterations: 1 });
    const vars: TextGradVariable[] = [
      { id: "instruction", content: "I", role: "instruction" },
      { id: "demo", content: "DEMO-ORIGINAL", role: "demo" },
    ];
    const grads = opt.backprop({ trajectoryId: "t", feedback: "f" }, vars);
    const applied = opt.applyGradients(vars, grads);
    // only instruction patched; demo untouched
    expect(applied.content).toContain("DEMO-ORIGINAL");
    expect(grads.find((g) => g.varId === "demo")?.suggestion ?? "").toBe("");
  });
});
