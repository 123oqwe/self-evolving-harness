// L1-T04a · compaction prompt 进化 loop-a：beam-search reflective mutation 驱动器
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T04a spec 编写。
// 依赖 L3-T03 mutator 接口；spec 允许 stub。这里用 mock LlmMutator + mock sandbox。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  EvolutionDriver,
  type VariantCandidate,
  type Substrate,
  type FailureTrajectory,
  type LlmMutator,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const SAFETY = "Never drop tool_use_id pairing.";
const BASELINE = `## Goal
<safety>${SAFETY}</safety>
Summarize.
`;

interface TelemetrySink { write(e: Record<string, unknown>): void; }
interface SandboxExecutor {
  run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>;
}

function makeSandbox(agentSessionId = "agent-session-1") {
  const sessions: string[] = [];
  const sandbox: SandboxExecutor = {
    async run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T> {
      const sid = opts?.sessionId ?? "mutator-session-" + (sessions.length + 1);
      sessions.push(sid);
      return fn();
    },
  };
  return { sandbox, sessions, agentSessionId };
}

function makeMutator(outputs: string[]) {
  let i = 0;
  const calls: { prompt: string; failures: FailureTrajectory[] }[] = [];
  const mutator: LlmMutator = {
    async mutate(prompt: string, failures: FailureTrajectory[]) {
      calls.push({ prompt, failures });
      const out = outputs[i++] ?? outputs[outputs.length - 1] ?? prompt;
      return out;
    },
  };
  return { mutator, calls };
}

function setupRepo(root: string): RepoLock {
  mkdirSync(join(root, "prompts"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  writeFileSync(join(root, "prompts/compaction-summary.md"), BASELINE, "utf8");
  return {
    versionSha: "c".repeat(40),
    files: [{ path: "prompts/compaction-summary.md", sha256: sha(BASELINE) }],
  };
}

describe("L1-T04a", () => {
  let root: string;
  let sink: TelemetrySink;
  let events: Record<string, unknown>[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t04a-"));
    events = [];
    sink = { write: (e) => events.push(e) };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function makeSubstrate(): Substrate {
    return { kind: "compaction", activePath: "prompts/compaction-summary.md", content: BASELINE };
  }

  it("generateCandidates returns up to 3 candidates with parentSha", async () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const { sandbox, sessions } = makeSandbox();
    const variants = [BASELINE + "\n<!-- patch1 -->", BASELINE + "\n<!-- patch2 -->", BASELINE + "\n<!-- patch3 -->"];
    const { mutator } = makeMutator(variants);
    const driver = new EvolutionDriver({ beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1" });
    const failures: FailureTrajectory[] = [
      { trajectoryId: "t1", failureSummary: "lost X", rereadCount: 3 },
    ];
    const candidates = await driver.generateCandidates(makeSubstrate(), failures);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.length).toBe(3);
    for (const c of candidates) {
      expect(c.substrate).toBe("compaction");
      expect(c.parentSha).toBe(sha(BASELINE));
      expect(c.content).toContain("<safety>");
    }
    // mutator 在沙箱内、独立 session
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s !== "agent-session-1")).toBe(true);
  });

  it("generateCandidates drops candidate that deletes safety segment", async () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const { sandbox } = makeSandbox();
    const badVariant = BASELINE.replace(/<safety>[\s\S]*?<\/safety>/, "") + "\nno safety";
    const { mutator } = makeMutator([badVariant, BASELINE + "\n<!-- ok -->", BASELINE + "\n<!-- ok2 -->"]);
    const driver = new EvolutionDriver({ beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1" });
    const candidates = await driver.generateCandidates(makeSubstrate(), [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 1 },
    ]);
    // 删 safety 的候选被 reject，不进 staging
    for (const c of candidates) {
      expect(c.content).toContain("<safety>");
    }
    // candidate_rejected_safety 事件落 log
    expect(events.some((e) => String(e.event ?? e.kind ?? "").includes("safety"))).toBe(true);
    // staging 中无删 safety 的文件
    const staged = readdirSync(join(root, "staging")).filter((f) => f.endsWith(".md"));
    for (const f of staged) {
      expect(readFileSync(join(root, "staging", f), "utf8")).toContain("<safety>");
    }
  });

  it("generateCandidates returns empty on no failure trajectories", async () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const { sandbox } = makeSandbox();
    const { mutator } = makeMutator([BASELINE]);
    const driver = new EvolutionDriver({ beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1" });
    const candidates = await driver.generateCandidates(makeSubstrate(), []);
    expect(candidates).toEqual([]);
  });

  it("generateCandidates returns empty on mutator failure", async () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const { sandbox } = makeSandbox();
    const mutator: LlmMutator = {
      async mutate() { throw new Error("LLM unavailable"); },
    };
    const driver = new EvolutionDriver({ beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1" });
    const candidates = await driver.generateCandidates(makeSubstrate(), [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 1 },
    ]);
    expect(candidates).toEqual([]);
    expect(events.some((e) => String(e.event ?? e.kind ?? "").includes("mutator"))).toBe(true);
  });

  it("generateCandidates runs mutator in sandbox with distinct session", async () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const { sandbox, sessions } = makeSandbox("agent-session-1");
    const { mutator } = makeMutator([BASELINE + "\n<!-- p -->"]);
    const driver = new EvolutionDriver({ beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1" });
    await driver.generateCandidates(makeSubstrate(), [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 1 },
    ]);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s).not.toBe("agent-session-1");
    }
  });
});
