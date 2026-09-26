// PLG-T03: evolve-opencode — OpenCode HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T03。
// RED 态：`@harness/evolve-opencode` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/storage/session/{info,message,part}/*.json
// （三层分层 JSON，pretty-printed 2 空格缩进，error part 含 is_error）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  OpenCodeAdapter,
  createOpenCodePlugin,
} from "@harness/evolve-opencode";
import type { OpenCodeAdapterOptions } from "@harness/evolve-opencode";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const DATA_DIR = FIXTURES; // storage/ 在 fixtures 根下

function newAdapter(repoRoot: string, dataDir = DATA_DIR): OpenCodeAdapter {
  const opts: OpenCodeAdapterOptions = {
    configDir: join(repoRoot, ".opencode"),
    dataDir,
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new OpenCodeAdapter(opts);
}

describe("PLG-T03 OpenCodeAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile(".opencode/AGENTS.md", "# opencode instructions\n\nbaseline\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate reads .opencode/AGENTS.md", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("opencode/AGENTS.md");
    expect(sub.content).toContain("opencode instructions");
    expect(sub.sha).toBe(contentSha(repo.read(".opencode/AGENTS.md")));
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256(".opencode/AGENTS.md");
    await a.writeSubstrate("opencode/AGENTS.md", "# mutated\n");
    expect(repo.sha256(".opencode/AGENTS.md")).toBe(before);
  });

  it("readTrajectories reassembles info/message/part into Trajectory[]", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "sess-oc-fail");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories skips orphan info (missing message/part)", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("sess-oc-orphan");
  });

  it("readTrajectories skips malformed info.json without throwing", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("sess-oc-bad");
  });

  it("readTrajectories returns [] when dataDir missing", async () => {
    const a = newAdapter(repo.root, join(FIXTURES, "no-such-data-dir"));
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("deploy bumps version + git commits + prints restart hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("opencode/AGENTS.md", "# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/restart opencode/i);
  });

  it("rollback git-checkouts .opencode/ to rollbackTo sha", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("opencode/AGENTS.md", "# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read(".opencode/AGENTS.md")).not.toContain("mutated");
  });

  it("llmPort is pass-through", () => {
    const llm = new FakeLLM("improve");
    const a = new OpenCodeAdapter({
      configDir: join(repo.root, ".opencode"),
      dataDir: DATA_DIR,
      repoRoot: repo.root,
      llmPort: llm,
    });
    expect(a.llmPort).toBe(llm);
  });

  it("createOpenCodePlugin returns a HarnessPort", () => {
    const port = createOpenCodePlugin({
      configDir: join(repo.root, ".opencode"),
      dataDir: DATA_DIR,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("opencode/missing.md")).rejects.toThrow(/substrate not found/i);
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
