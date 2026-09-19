// L1-T05a · system phase prompt 进化 loop-a：beam-search reflective mutation 驱动器
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T05a spec 编写。
// 区别：substrate='phase'，签名校验覆盖 safety + identity 两段。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  PhaseEvolutionDriver,
  type PhaseVariantCandidate,
  type Substrate,
  type FailureTrajectory,
  type LlmMutator,
} from "@harness/l1-config";
import {
  ConfigRepo,
  SignatureVerifier,
  type RepoLock,
  type SignatureManifest,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const SAFETY = "Never drop tool_use_id pairing.";
const IDENTITY = "You are a coding agent for repo <repo>.";
const CODING = `<identity>${IDENTITY}</identity>
<safety>${SAFETY}</safety>
Phase coding instructions.`;

function segSha(content: string, seg: "safety" | "identity"): string {
  const m = content.match(new RegExp(`<${seg}>([\\s\\S]*?)<\\/${seg}>`));
  if (!m) throw new Error("no " + seg);
  return sha(m[1]!.trim());
}

function setup(root: string) {
  mkdirSync(join(root, "prompts"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  const init = `<identity>${IDENTITY}</identity><safety>${SAFETY}</safety>init`;
  const review = `<identity>${IDENTITY}</identity><safety>${SAFETY}</safety>review`;
  writeFileSync(join(root, "prompts/phase-init.md"), init, "utf8");
  writeFileSync(join(root, "prompts/phase-coding.md"), CODING, "utf8");
  writeFileSync(join(root, "prompts/phase-review.md"), review, "utf8");
  const lock: RepoLock = {
    versionSha: "d".repeat(40),
    files: [
      { path: "prompts/phase-init.md", sha256: sha(init) },
      { path: "prompts/phase-coding.md", sha256: sha(CODING) },
      { path: "prompts/phase-review.md", sha256: sha(review) },
    ],
  };
  const manifest: SignatureManifest = {
    entries: [
      { filePath: "prompts/phase-init.md", segmentId: "safety", sha256: segSha(init, "safety") },
      { filePath: "prompts/phase-coding.md", segmentId: "safety", sha256: segSha(CODING, "safety") },
      { filePath: "prompts/phase-review.md", segmentId: "safety", sha256: segSha(review, "safety") },
      { filePath: "prompts/phase-coding.md", segmentId: "identity", sha256: segSha(CODING, "identity") },
    ],
  };
  return { lock, manifest };
}

interface TelemetrySink { write(e: Record<string, unknown>): void; }
interface SandboxExecutor { run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>; }

function makeSandbox() {
  const sessions: string[] = [];
  const sandbox: SandboxExecutor = {
    async run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T> {
      sessions.push(opts?.sessionId ?? "mut-" + sessions.length);
      return fn();
    },
  };
  return { sandbox, sessions };
}

describe("L1-T05a", () => {
  let root: string;
  let events: Record<string, unknown>[];
  let sink: TelemetrySink;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t05a-"));
    events = [];
    sink = { write: (e) => events.push(e) };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("generatePhaseCandidates returns candidates only for requested phase", async () => {
    const { lock, manifest } = setup(root);
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const { sandbox } = makeSandbox();
    const patched = CODING + "\n<!-- dynamic patch -->";
    const mutator: LlmMutator = { async mutate() { return patched; } };
    const driver = new PhaseEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, verifier, agentSessionId: "agent-session-1",
    } as never);
    const candidates = await driver.generatePhaseCandidates("phase", [
      { trajectoryId: "t1", failureSummary: "generalize fail", rereadCount: 2 },
    ]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates as PhaseVariantCandidate[]) {
      expect(c.phase).toBe("coding");
      expect(c.parentSha).toBe(sha(CODING));
      expect(c.content).toContain("<safety>");
    }
  });

  it("generatePhaseCandidates rejects candidate mutating static identity segment", async () => {
    const { lock, manifest } = setup(root);
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const { sandbox } = makeSandbox();
    // 改 identity 段
    const badIdentity = CODING.replace("You are a coding agent for repo <repo>.", "You are a different agent.");
    const mutator: LlmMutator = { async mutate() { return badIdentity; } };
    const driver = new PhaseEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, verifier, agentSessionId: "agent-session-1",
    } as never);
    const candidates = await driver.generatePhaseCandidates("phase", [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 1 },
    ]);
    expect(candidates).toEqual([]);
  });

  it("generatePhaseCandidates rejects candidate deleting safety", async () => {
    const { lock, manifest } = setup(root);
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const { sandbox } = makeSandbox();
    const noSafety = CODING.replace(/<safety>[\s\S]*?<\/safety>/, "");
    const mutator: LlmMutator = { async mutate() { return noSafety; } };
    const driver = new PhaseEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, verifier, agentSessionId: "agent-session-1",
    } as never);
    const candidates = await driver.generatePhaseCandidates("phase", [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 1 },
    ]);
    expect(candidates).toEqual([]);
  });

  it("generatePhaseCandidates returns empty on no failures", async () => {
    const { lock, manifest } = setup(root);
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const { sandbox } = makeSandbox();
    const mutator: LlmMutator = { async mutate() { return CODING; } };
    const driver = new PhaseEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, verifier, agentSessionId: "agent-session-1",
    } as never);
    const candidates = await driver.generatePhaseCandidates("phase", []);
    expect(candidates).toEqual([]);
  });
});
