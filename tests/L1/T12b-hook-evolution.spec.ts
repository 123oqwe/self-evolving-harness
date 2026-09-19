// L1-T12b · hook policy 进化 loop（AgentDojo/ASB 双 Pareto safety∧utility；agent 绝对无写权）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T12b spec 编写。

import { describe, it, expect } from "vitest";
import {
  HookEvolutionDriver,
  type HookCandidateScore,
  type HookRule,
  type HookVariantCandidate,
  type LlmMutator,
  type FailureTrajectory,
} from "@harness/l1-config";

function hs(o: Partial<HookCandidateScore>): HookCandidateScore {
  return {
    attackSuccessRate: o.attackSuccessRate ?? 0.1,
    falseDenyRate: o.falseDenyRate ?? 0.1,
    isBaseline: o.isBaseline ?? false,
  };
}

interface TelemetrySink { write(e: Record<string, unknown>): void; }
interface SandboxExecutor { run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>; }

describe("L1-T12b", () => {
  const sink: TelemetrySink = { write: () => {} };

  it("generateHookCandidates passes breaker precheck", async () => {
    const sandbox: SandboxExecutor = { async run(fn) { return fn(); } };
    // 候选含 bash deny→allow → breaker reject
    const badPatch = "Bash decision: deny -> allow";
    const mutator: LlmMutator = { async mutate() { return badPatch; } };
    const driver = new HookEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, agentSessionId: "agent-1",
    } as never);
    const baseline: HookRule[] = [
      { matcher: "Bash", decision: "deny", reason: "destructive" },
    ];
    const candidates = await driver.generateHookCandidates(baseline, [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 0 } as FailureTrajectory,
    ]);
    expect(candidates).toEqual([]);
  });

  it("select passes candidate with attack↓ ∧ false-deny↓", () => {
    const driver = new HookEvolutionDriver({ beamWidth: 3, telemetry: sink, agentSessionId: "a" } as never);
    const baseline = hs({ isBaseline: true, attackSuccessRate: 0.2, falseDenyRate: 0.15 });
    const cand = hs({ attackSuccessRate: 0.1, falseDenyRate: 0.1 });
    const selected = driver.select([cand], baseline);
    expect(selected.some((c) => c.attackSuccessRate === 0.1)).toBe(true);
  });

  it("select rejects candidate trading utility for safety (false-deny↑)", () => {
    const driver = new HookEvolutionDriver({ beamWidth: 3, telemetry: sink, agentSessionId: "a" } as never);
    const baseline = hs({ isBaseline: true, attackSuccessRate: 0.2, falseDenyRate: 0.15 });
    // attack↓ 但 false-deny↑（用 utility 换 safety）→ reject
    const cand = hs({ attackSuccessRate: 0.1, falseDenyRate: 0.25 });
    const selected = driver.select([cand], baseline);
    expect(selected.some((c) => c.attackSuccessRate === 0.1)).toBe(false);
  });

  it("select rejects candidate trading safety for utility (attack↑)", () => {
    const driver = new HookEvolutionDriver({ beamWidth: 3, telemetry: sink, agentSessionId: "a" } as never);
    const baseline = hs({ isBaseline: true, attackSuccessRate: 0.2, falseDenyRate: 0.15 });
    // attack↑ false-deny↓（用 safety 换 utility）→ reject
    const cand = hs({ attackSuccessRate: 0.3, falseDenyRate: 0.1 });
    const selected = driver.select([cand], baseline);
    expect(selected.some((c) => c.attackSuccessRate === 0.3)).toBe(false);
  });

  it("agent runtime write to hooks/policy.yaml → EPERM", () => {
    const driver = new HookEvolutionDriver({ beamWidth: 3, telemetry: sink, agentSessionId: "a" } as never);
    // agent 运行时绝对无写权（L0C-T11 只读强制）：driver 不得暴露任何 policy 写入入口
    expect((driver as unknown as { writePolicy?: unknown }).writePolicy).toBeUndefined();
    expect((driver as unknown as { writePolicyYaml?: unknown }).writePolicyYaml).toBeUndefined();
  });
});
