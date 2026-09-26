// PLG-T05: evolve-openclaw — OpenClaw HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T05。
// RED 态：`@harness/evolve-openclaw` 包未实现 → import 失败 = 合法 RED。
// fixture：
//   tests/plugin/fixtures/openclaw-workspace/{skills/evolve/SKILL.md, AGENTS.md}
//   tests/plugin/fixtures/openclaw-agent/agents/<agentId>/{agent/openclaw-agent.sqlite, sessions/*.jsonl}
// （SQLite + archived JSONL 双源合并；部分 session 含 error 信号）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  OpenClawAdapter,
  createOpenClawPlugin,
} from "@harness/evolve-openclaw";
import type { OpenClawAdapterOptions } from "@harness/evolve-openclaw";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const WORKSPACE_DIR = join(FIXTURES, "openclaw-workspace");
const STATE_DIR = join(FIXTURES, "openclaw-agent");
// jsonl-only fixture：有 sessions/*.jsonl 但无 agent/openclaw-agent.sqlite（验证 sqlite 缺失时回退 jsonl）。
const STATE_DIR_JSONL_ONLY = join(FIXTURES, "openclaw-agent-jsonl-only");
const AGENT_ID = "oc-agent-1";

function newAdapter(repoRoot: string): OpenClawAdapter {
  const opts: OpenClawAdapterOptions = {
    workspaceDir: WORKSPACE_DIR,
    stateDir: STATE_DIR,
    agentId: AGENT_ID,
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new OpenClawAdapter(opts);
}

describe("PLG-T05 OpenClawAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("skills/evolve/SKILL.md", "# baseline\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate reads workspace skills SKILL.md", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("openclaw/skills/evolve/SKILL.md");
    expect(sub.content).toContain("openclaw evolve skill");
    expect(sub.sha).toBe(contentSha(readFile(WORKSPACE_DIR, "skills/evolve/SKILL.md")));
  });

  it("readSubstrate reads workspace AGENTS.md", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("openclaw/AGENTS.md");
    expect(sub.content).toContain("openclaw agents");
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256("skills/evolve/SKILL.md");
    await a.writeSubstrate("openclaw/skills/evolve/SKILL.md", "# mutated\n");
    expect(repo.sha256("skills/evolve/SKILL.md")).toBe(before);
  });

  it("readTrajectories merges sqlite + archived jsonl sources", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    // sqlite 源
    expect(ids).toContain("oc-fail-1");
    // jsonl 源
    expect(ids).toContain("oc-jsonl-fail-1");
    for (const t of trajs) {
      expect(t.failed).toBe(true);
      expect(t.diagnosis.length).toBeGreaterThan(0);
    }
  });

  it("readTrajectories reads jsonl-only when sqlite missing", async () => {
    // STATE_DIR_JSONL_ONLY 有 sessions/*.jsonl 但无 agent/openclaw-agent.sqlite：
    // 适配器须回退到 jsonl 源提取（不许因 sqlite 缺失就返回 []）。
    const a = new OpenClawAdapter({
      workspaceDir: WORKSPACE_DIR,
      stateDir: STATE_DIR_JSONL_ONLY, // sqlite 缺失，仅 jsonl
      agentId: AGENT_ID,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).toContain("oc-jsonl-only-1"); // jsonl 源的失败 session 仍被提取
    const fail = trajs.find((t) => t.sessionId === "oc-jsonl-only-1");
    expect(fail!.failed).toBe(true);
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
    // 无 error 信号的 session 不入结果
    expect(ids).not.toContain("oc-jsonl-only-ok");
  });

  it("readTrajectories returns [] when agentId dir missing", async () => {
    const a = new OpenClawAdapter({
      workspaceDir: WORKSPACE_DIR,
      stateDir: STATE_DIR,
      agentId: "no-such-agent",
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("readTrajectories skips malformed archived jsonl", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const mal = trajs.find((t) => t.sessionId === "oc-jsonl-mal-1");
    expect(mal).toBeDefined(); // 合法行仍提取
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("oc-jsonl-ok-1"); // 无 error 信号跳过
  });

  it("deploy bumps version + git commits + syncs workspace + prints hybrid-reload hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("openclaw/skills/evolve/SKILL.md", "# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/hybrid|watcher|next agent turn/i);
  });

  it("rollback git-checkouts + syncs workspace skills", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("openclaw/skills/evolve/SKILL.md", "# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read("skills/evolve/SKILL.md")).not.toContain("mutated");
  });

  it("llmPort is pass-through", () => {
    const llm = new FakeLLM("improve");
    const a = new OpenClawAdapter({
      workspaceDir: WORKSPACE_DIR,
      stateDir: STATE_DIR,
      agentId: AGENT_ID,
      repoRoot: repo.root,
      llmPort: llm,
    });
    expect(a.llmPort).toBe(llm);
  });

  it("createOpenClawPlugin returns a HarnessPort", () => {
    const port = createOpenClawPlugin({
      workspaceDir: WORKSPACE_DIR,
      stateDir: STATE_DIR,
      agentId: AGENT_ID,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("openclaw/missing.md")).rejects.toThrow(/substrate not found/i);
  });
});

function readFile(home: string, rel: string): string {
  const { readFileSync } = require("node:fs");
  return readFileSync(join(home, rel), "utf8");
}

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
