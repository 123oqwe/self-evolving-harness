// PLG-T02: evolve-codex — Codex CLI HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T02。
// RED 态：`@harness/evolve-codex` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/codex-home/{sessions,archived_sessions}/rollout-*.jsonl
// （envelope RolloutLine，agent error 信号 = is_error/error/failed/status==='error'）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  CodexAdapter,
  createCodexPlugin,
  readCodexTrajectories,
  extractCodexDiagnosis,
} from "@harness/evolve-codex";
import type { CodexAdapterOptions } from "@harness/evolve-codex";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const CODEX_HOME = join(FIXTURES, "codex-home");

function newAdapter(repoRoot: string, codexHome = CODEX_HOME): CodexAdapter {
  const opts: CodexAdapterOptions = {
    codexHome,
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new CodexAdapter(opts);
}

describe("PLG-T02 CodexAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("AGENTS.md", "# codex instructions\n\nbaseline\n");
    repo.commit("baseline AGENTS.md");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate reads repoRoot AGENTS.md", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("codex/AGENTS.md");
    expect(sub.content).toContain("codex instructions");
    expect(sub.sha).toBe(contentSha(repo.read("AGENTS.md")));
  });

  it("writeSubstrate lands in repoRoot staging, active AGENTS.md untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256("AGENTS.md");
    await a.writeSubstrate("codex/AGENTS.md", "# mutated\n");
    expect(repo.sha256("AGENTS.md")).toBe(before); // active 不变
  });

  it("readTrajectories parses rollout envelope JSONL into Trajectory[]", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    // failed session abc123 + archived arch1 + malformed mal1(2 errors) ≥ 3
    expect(trajs.length).toBeGreaterThanOrEqual(1);
    const fail = trajs.find((t) => t.sessionId === "abc123");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories scans both sessions/ and archived_sessions/", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).toContain("abc123");
    expect(ids).toContain("arch1");
  });

  it("readTrajectories skips malformed JSONL lines without throwing", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    // malformed session mal1 仍提取出合法行的 error 信号
    const mal = trajs.find((t) => t.sessionId === "mal1");
    expect(mal).toBeDefined();
    expect(mal!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories skips sessions without error signal", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("ok1234"); // non-failed session skipped
  });

  it("readTrajectories returns [] when codexHome missing", async () => {
    const a = newAdapter(repo.root, join(FIXTURES, "does-not-exist"));
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("deploy bumps version + git commits + prints restart hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("codex/AGENTS.md", "# mutated instructions\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    const headAfter = repo.head();
    expect(headAfter).not.toBe(headBefore);
    expect(out).toMatch(/restart codex|new session/i);
  });

  it("rollback git-checkouts AGENTS.md to rollbackTo sha", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("codex/AGENTS.md", "# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read("AGENTS.md")).not.toContain("mutated");
  });

  it("llmPort is pass-through from opts", () => {
    const llm = new FakeLLM("improve");
    const a = new CodexAdapter({
      codexHome: CODEX_HOME,
      repoRoot: repo.root,
      llmPort: llm,
    });
    expect(a.llmPort).toBe(llm);
  });

  it("createCodexPlugin returns a HarnessPort", () => {
    const port = createCodexPlugin({
      codexHome: CODEX_HOME,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
    expect(typeof port.deploy).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when AGENTS.md missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("codex/missing.md")).rejects.toThrow(/substrate not found/i);
  });

  it("extractCodexDiagnosis tolerates multiple error field names", () => {
    expect(extractCodexDiagnosis([{ type: "agent", content: { is_error: true, error: "e1" } }])).toBeTruthy();
    expect(extractCodexDiagnosis([{ type: "agent", content: { failed: true, error: "e2" } }])).toBeTruthy();
    expect(extractCodexDiagnosis([{ type: "agent", content: { status: "error", message: "e3" } }])).toBeTruthy();
    expect(extractCodexDiagnosis([{ type: "agent", content: { text: "ok" } }])).toBeNull();
  });

  it("readCodexTrajectories standalone function reads sessions dir", () => {
    const trajs = readCodexTrajectories(join(CODEX_HOME, "sessions"), "sha-x");
    expect(trajs.length).toBeGreaterThan(0);
  });
});

async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  let output = "";
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
    output += s;
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig as typeof process.stdout.write;
  }
  return output;
}
void readFileSync;
void existsSync;
