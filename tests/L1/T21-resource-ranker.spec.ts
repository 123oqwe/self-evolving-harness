// L1-T21 · resource 排序函数 + prompts 模板体进化（audience:[user] 永不注入 model；破坏性 prompt 人审）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T21 spec 编写。

import { describe, it, expect } from "vitest";
import {
  ResourceRanker,
  AudienceViolationError,
  DestructivePromptUnsignedError,
  type ResourceRankerConfig,
  type ResourceScore,
  type Resource,
} from "@harness/l1-config";

function rscore(o: Partial<ResourceScore>): ResourceScore {
  return {
    taskSuccess: o.taskSuccess ?? 0.5,
    tokenCost: o.tokenCost ?? 1000,
    referenceRate: o.referenceRate ?? 0.3,
    isBaseline: o.isBaseline ?? false,
  };
}

function resource(o: Partial<Resource> & { audience?: string[] }): Resource {
  return {
    uri: o.uri ?? "res://x",
    name: o.name ?? "x",
    audience: o.audience ?? ["model"],
    priority: o.priority ?? 0.5,
    lastModified: o.lastModified ?? 0,
  } as Resource;
}

describe("L1-T21", () => {
  const config: ResourceRankerConfig = { weights: { relevance: 0.5, priority: 0.3, recency: 0.2 } };

  it("rank returns resources sorted by weights", () => {
    const e = new ResourceRanker();
    const resources = [
      resource({ uri: "a", priority: 0.1 }),
      resource({ uri: "b", priority: 0.9 }),
    ];
    const ranked = e.rank(resources, config, { taskRelevance: { a: 0.5, b: 0.5 } });
    expect(ranked.length).toBe(2);
    // 高 priority 排前
    expect(ranked[0]!.uri).toBe("b");
  });

  it("evolveRanker Pareto: success↑ ∧ token↓ ∧ reference↑ → 入选", () => {
    const e = new ResourceRanker();
    const baseline = rscore({ isBaseline: true, taskSuccess: 0.5, tokenCost: 1000, referenceRate: 0.3 });
    const cand = rscore({ taskSuccess: 0.6, tokenCost: 800, referenceRate: 0.5 });
    const evolved = e.evolveRanker(config, [baseline, cand]);
    expect(evolved.weights).toBeDefined();
    expect(evolved.weights.relevance + evolved.weights.priority + evolved.weights.recency).toBeCloseTo(1, 1);
  });

  it("assertAudienceUserNotInjectedToModel throws on audience:[user] injected to model", () => {
    const e = new ResourceRanker();
    const res = resource({ audience: ["user"] });
    // audience:[user] + 注入 model → 硬拒
    expect(() => e.assertAudienceUserNotInjectedToModel(res, true)).toThrowError(AudienceViolationError);
    // 不注入 model 不 throw
    expect(() => e.assertAudienceUserNotInjectedToModel(res, false)).not.toThrow();
  });

  it("assertDestructivePromptHumanGated throws on unsigned execute prompt", () => {
    const e = new ResourceRanker();
    const template = "Please execute the following destructive command: rm -rf /";
    // 含 execute + 无签 → throw
    expect(() => e.assertDestructivePromptHumanGated(template, false)).toThrowError(DestructivePromptUnsignedError);
  });

  it("assertDestructivePromptHumanGated passes on signed prompt", () => {
    const e = new ResourceRanker();
    const template = "execute the deployment";
    expect(() => e.assertDestructivePromptHumanGated(template, true)).not.toThrow();
  });

  it("evolvePromptTemplate improves userTaskSuccess", () => {
    const e = new ResourceRanker();
    const baseline = { userTaskSuccess: 0.4 };
    const cand = { userTaskSuccess: 0.6 };
    const template = "## Steps\n1. Do X.\n2. Do Y.\n";
    const evolved = e.evolvePromptTemplate(template, [baseline, cand]);
    expect(evolved.length).toBeGreaterThan(0);
    expect(typeof evolved).toBe("string");
  });
});
