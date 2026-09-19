// L1-T07 · tool description/field-doc 进化 loop（ExpeL+TextGrad；selection∧resolve 联合；形状锁；贬抑语 flag）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T07 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ToolEvolutionDriver,
  ToolSelectRetain,
  type ToolDoc,
  type ToolCandidateScore,
  type ToolVariantCandidate,
  type LlmMutator,
  type FailureTrajectory,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const BASH_YAML = `name: bash
description: Execute a shell command.
inputSchema:
  types: ["string"]
  required: ["command"]
  enum: {}
fieldDoc:
  command: The command to run.
examples:
  - ls -la
`;

function setup(root: string): RepoLock {
  mkdirSync(join(root, "tools/registry"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  writeFileSync(join(root, "tools/registry/bash.yaml"), BASH_YAML, "utf8");
  return { versionSha: "g".repeat(40), files: [{ path: "tools/registry/bash.yaml", sha256: sha(BASH_YAML) }] };
}

function tscore(o: Partial<ToolCandidateScore>): ToolCandidateScore {
  return {
    candidateId: o.candidateId ?? "c1",
    selectionAccuracy: o.selectionAccuracy ?? 0,
    resolveRate: o.resolveRate ?? 0,
    descriptionTokens: o.descriptionTokens ?? 0,
    isBaseline: o.isBaseline ?? false,
  };
}

interface TelemetrySink { write(e: Record<string, unknown>): void; }
interface SandboxExecutor { run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>; }

describe("L1-T07", () => {
  let root: string;
  let events: Record<string, unknown>[];
  let sink: TelemetrySink;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t07-"));
    events = [];
    sink = { write: (e) => events.push(e) };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("generateToolCandidates patches only description not name/schema", async () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const patched = BASH_YAML.replace("Execute a shell command.", "Execute a shell command with care.");
    const mutator: LlmMutator = { async mutate() { return patched; } };
    const sandbox: SandboxExecutor = { async run(fn) { return fn(); } };
    const driver = new ToolEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1",
      baselineShape: { types: ["string"], required: ["command"], enum: {} },
    } as never);
    const baseline: ToolDoc = {
      name: "bash",
      description: "Execute a shell command.",
      inputSchema: { types: ["string"], required: ["command"], enum: {} },
      fieldDoc: { command: "The command to run." },
      examples: ["ls -la"],
    } as ToolDoc;
    const candidates = await driver.generateToolCandidates(baseline, [
      { trajectoryId: "t1", failureSummary: "wrong tool picked", rereadCount: 0 },
    ]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates as ToolVariantCandidate[]) {
      expect(c.toolName).toBe("bash");
      // descriptionPatch 不含 name/types 改动（仅 description/field-doc/examples 可变）
      expect(c.descriptionPatch).not.toContain("name: other");
    }
  });

  it("select rejects candidate with resolve degrade (cheat selection)", () => {
    const sr = new ToolSelectRetain({} as never);
    const baseline = tscore({ isBaseline: true, selectionAccuracy: 0.6, resolveRate: 0.5, descriptionTokens: 100 });
    // selection↑ resolve↓ → 骗选中 → reject
    const cand = tscore({ candidateId: "v1", selectionAccuracy: 0.7, resolveRate: 0.45, descriptionTokens: 100 });
    const selected = sr.select([cand], baseline, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(false);
  });

  it("select passes candidate with selection∧resolve improve + token soft loss", () => {
    const sr = new ToolSelectRetain({} as never);
    const baseline = tscore({ isBaseline: true, selectionAccuracy: 0.6, resolveRate: 0.5, descriptionTokens: 100 });
    // selection∧resolve 改善，tokens 略增（软目标损失 < τ）
    const cand = tscore({ candidateId: "v1", selectionAccuracy: 0.65, resolveRate: 0.52, descriptionTokens: 105 });
    const selected = sr.select([cand], baseline, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(true);
  });

  it("commitOnSuccess rejects shape mutation", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sr = new ToolSelectRetain({ repo, telemetry: sink, baselineShape: { types: ["string"], required: ["command"], enum: {} } } as never);
    // 候选改了 types 字段
    const badContent = BASH_YAML.replace('types: ["string"]', 'types: ["string","boolean"]');
    const candidate: ToolVariantCandidate = {
      id: "tv-1",
      substrate: "tool",
      toolName: "bash",
      descriptionPatch: badContent,
      parentSha: sha(BASH_YAML),
      content: badContent,
      provenance: { trajectoryId: "t1", mutatorSession: "mut-1", generatedAt: Date.now() },
    } as ToolVariantCandidate;
    expect(() => sr.commitOnSuccess(candidate, [tscore({ isBaseline: true }), tscore({ candidateId: "tv-1", selectionAccuracy: 0.7, resolveRate: 0.55, descriptionTokens: 100 })])).toThrow();
    expect(events.some((e) => String(e.event ?? e.kind ?? "").includes("shape"))).toBe(true);
  });

  it("generateToolCandidates flags disparagement and excludes from staging", async () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const disparaging = BASH_YAML.replace("Execute a shell command.", "Execute a shell command. Better than grep.");
    const mutator: LlmMutator = { async mutate() { return disparaging; } };
    const sandbox: SandboxExecutor = { async run(fn) { return fn(); } };
    const driver = new ToolEvolutionDriver({
      beamWidth: 3, mutator, sandbox, telemetry: sink, repo, agentSessionId: "agent-session-1",
      baselineShape: { types: ["string"], required: ["command"], enum: {} },
    } as never);
    const baseline: ToolDoc = {
      name: "bash",
      description: "Execute a shell command.",
      inputSchema: { types: ["string"], required: ["command"], enum: {} },
      fieldDoc: {},
      examples: [],
    } as ToolDoc;
    const candidates = await driver.generateToolCandidates(baseline, [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 0 },
    ]);
    // 贬抑语候选不进 staging
    expect(candidates).toEqual([]);
    const staged = readdirSync(join(root, "staging")).filter((f) => f.includes("bash"));
    expect(staged).toEqual([]);
  });
});
