// L3-T03: reflective mutation 生成器 [MVP]
//
// RED state: ReflectiveMutator / Trajectory / LLMPort / LuckyPassTrajectoryRejected
// / MalformedMutation not exported → RED. After implementation these validate
// GEPA reflective mutation + luckyPass defence-in-depth guard.
//
// Spec: execution/L3-engine/TASKS.md §L3-T03.

import { describe, it, expect } from "vitest";
import {
  ReflectiveMutator,
  LuckyPassTrajectoryRejected,
  MalformedMutation,
} from "@harness/l3-engine";
import type { Substrate, Trajectory, Mutant } from "@harness/l3-engine";
import { FakeLLM } from "./fixtures/fake-llm";
import { makeTrajectory } from "./fixtures/fake-trajectory";
import { makeSubstrate } from "./fixtures/factories";

const substrate: Substrate = makeSubstrate({ sha: "sha-parent", content: "baseline prompt" });

/** Simple edit-distance (Levenshtein) for content-diff assertions. */
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

describe("L3-T03", () => {
  it("FakeLLM returns fixed JSON → mutate produces Mutant with origin='reflective' + parentSha=substrate.sha", async () => {
    // Given 1 failed trajectory + FakeLLM returning a mutation JSON
    const llm = new FakeLLM({
      defaultReply: JSON.stringify([
        { content: "rewritten prompt that fixes the failure" },
      ]),
    });
    const mutator = new ReflectiveMutator({ llm, maxCandidates: 3 });
    const failures: Trajectory[] = [
      makeTrajectory({ substrateSha: substrate.sha, luckyPass: false }),
    ];
    // When mutate
    const mutants = await mutator.mutate(substrate, failures);
    // Then
    expect(mutants.length).toBeGreaterThan(0);
    for (const m of mutants) {
      expect(m.origin).toBe("reflective");
      expect(m.parentSha).toBe(substrate.sha);
    }
  });

  it("input trajectory with luckyPass=true → throws LuckyPassTrajectoryRejected (defence-in-depth)", async () => {
    const llm = new FakeLLM({ defaultReply: "[]" });
    const mutator = new ReflectiveMutator({ llm, maxCandidates: 3 });
    const failures: Trajectory[] = [
      makeTrajectory({ substrateSha: substrate.sha, luckyPass: true }),
    ];
    // When mutate Then throws LuckyPassTrajectoryRejected
    await expect(mutator.mutate(substrate, failures)).rejects.toThrow(
      LuckyPassTrajectoryRejected,
    );
  });

  it("empty failures → returns [] (no reflection source)", async () => {
    const llm = new FakeLLM({ defaultReply: "[]" });
    const mutator = new ReflectiveMutator({ llm, maxCandidates: 3 });
    const mutants = await mutator.mutate(substrate, []);
    expect(mutants).toEqual([]);
  });

  it("FakeLLM returns non-JSON → throws MalformedMutation", async () => {
    const llm = new FakeLLM({ defaultReply: "this is not json {{{" });
    const mutator = new ReflectiveMutator({ llm, maxCandidates: 3 });
    const failures: Trajectory[] = [
      makeTrajectory({ substrateSha: substrate.sha, luckyPass: false }),
    ];
    await expect(mutator.mutate(substrate, failures)).rejects.toThrow(
      MalformedMutation,
    );
  });

  it("mutated content differs from original content (editDistance > 0)", async () => {
    const llm = new FakeLLM({
      defaultReply: JSON.stringify([
        { content: "completely different rewritten prompt content" },
      ]),
    });
    const mutator = new ReflectiveMutator({ llm, maxCandidates: 3 });
    const failures: Trajectory[] = [
      makeTrajectory({ substrateSha: substrate.sha, luckyPass: false }),
    ];
    const mutants: Mutant[] = await mutator.mutate(substrate, failures);
    expect(mutants.length).toBeGreaterThan(0);
    for (const m of mutants) {
      expect(editDistance(m.content, substrate.content)).toBeGreaterThan(0);
    }
  });
});
