// L1-T20 · 多 agent aggregation router + debate config（martingale 消融；token 多目标；投票独立先解）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T20 spec 编写。

import { describe, it, expect } from "vitest";
import {
  AggregationRouter,
  VoteNotIndependentError,
  DebateTopologyError,
  type AggRule,
  type AggScore,
} from "@harness/l1-config";

function ascore(o: Partial<AggScore>): AggScore {
  return { acceptance: o.acceptance ?? 0.5, tokenCost: o.tokenCost ?? 1000, isBaseline: o.isBaseline ?? false };
}

describe("L1-T20", () => {
  it("route returns vote for reasoning task", () => {
    const e = new AggregationRouter();
    const rule = e.route("reasoning");
    expect(["vote", "debate", "consensus"]).toContain(rule.protocol);
    // 推理类 → vote（martingale 显示 vote gain ≥ debate gain）
    expect(rule.protocol).toBe("vote");
  });

  it("martingaleAblation reports voteGain ≥ debateGain", () => {
    const e = new AggregationRouter();
    // vote 有增益（0.60→0.68），debate 增益更小（0.60→0.62）：多数投票单独占大部分增益
    const voteScores: AggScore[] = [ascore({ acceptance: 0.6 }), ascore({ acceptance: 0.68 })];
    const debateScores: AggScore[] = [ascore({ acceptance: 0.6 }), ascore({ acceptance: 0.62 })];
    const ablation = e.martingaleAblation(voteScores, debateScores);
    expect(ablation.voteGain).toBeGreaterThan(0);
    expect(ablation.debateGain).toBeGreaterThanOrEqual(0);
    // martingale 结论：vote gain ≥ debate gain（多数投票单独占大部分增益）
    expect(ablation.voteGain).toBeGreaterThanOrEqual(ablation.debateGain);
  });

  it("assertVoteIndependent throws on shared solver state", () => {
    const e = new AggregationRouter();
    const rule: AggRule = { taskType: "reasoning", protocol: "vote", agentCount: 3, maxRounds: 1, topology: "full" };
    // vote + solver 共享状态 → throw
    expect(() => e.assertVoteIndependent(rule, true)).toThrowError(VoteNotIndependentError);
    expect(() => e.assertVoteIndependent(rule, false)).not.toThrow();
  });

  it("assertDebateSparse throws on full topology", () => {
    const e = new AggregationRouter();
    const rule: AggRule = { taskType: "knowledge", protocol: "debate", agentCount: 5, maxRounds: 3, topology: "full" };
    // debate + full topology → 退化为 groupthink → throw
    expect(() => e.assertDebateSparse(rule, 5)).toThrowError(DebateTopologyError);
    expect(() => e.assertDebateSparse({ ...rule, topology: "sparse" }, 2)).not.toThrow();
  });

  it("evolve rejects max_rounds increase with no martingale gain", () => {
    const e = new AggregationRouter();
    const rules: AggRule[] = [
      { taskType: "reasoning", protocol: "vote", agentCount: 3, maxRounds: 1, topology: "full" },
    ];
    // martingale 显示无增益但增 max_rounds → reject
    const evolved = e.evolve(rules, [ascore({ isBaseline: true, acceptance: 0.6, tokenCost: 1000 })]);
    const reasoning = evolved.find((r) => r.taskType === "reasoning");
    expect(reasoning).toBeDefined();
    // 增轮数有害（problem drift）→ 不应盲目增 max_rounds
    expect(reasoning!.maxRounds).toBeLessThanOrEqual(2);
  });

  it("Pareto: acceptance↑ ∧ tokenCost not significantly↑ → 入选", () => {
    const e = new AggregationRouter();
    const rules: AggRule[] = [
      { taskType: "reasoning", protocol: "vote", agentCount: 3, maxRounds: 1, topology: "full" },
    ];
    const baseline = ascore({ isBaseline: true, acceptance: 0.5, tokenCost: 1000 });
    const cand = ascore({ acceptance: 0.6, tokenCost: 1050 });
    const evolved = e.evolve(rules, [baseline, cand]);
    expect(evolved.length).toBeGreaterThan(0);
  });
});
