// PLG-T11: evolve-dsh — DeepSeek Harness HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
// RED 态：`@harness/evolve-dsh` 包未实现 → import 失败 = 合法 RED。
// fixture：
//   tests/plugin/fixtures/dsh-home/profiles/default/cordis.patch.yml（profile 叠加层基质）
//   tests/plugin/fixtures/dsh-events/*.jsonl（append-only 事件流，多 session，含 error 事件）
// 诊断提取优先复用 @harness/adapters extractDiagnosis（TL-T01 同构），兜底私有 error 字段。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  DshAdapter,
  createDshPlugin,
  readDshTrajectories,
  eventStreamToTrajectory,
} from "@harness/evolve-dsh";
import type { DshAdapterOptions } from "@harness/evolve-dsh";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const DSH_HOME = join(FIXTURES, "dsh-home");
const DSH_EVENTS = join(FIXTURES, "dsh-events");

function newAdapter(repoRoot: string, dshHome = DSH_HOME): DshAdapter {
  const opts: DshAdapterOptions = {
    dshHome,
    profile: "default",
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new DshAdapter(opts);
}

describe("PLG-T11 DshAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("AGENTS.md", "# dsh instructions\n\nbaseline\n");
    repo.commit("baseline AGENTS.md");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate reads repoRoot AGENTS.md", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("dsh/AGENTS.md");
    expect(sub.content).toContain("dsh instructions");
    expect(sub.sha).toBe(contentSha(repo.read("AGENTS.md")));
  });

  it("readSubstrate reads profile cordis.patch.yml as opaque text", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("dsh/profiles/default/cordis.patch.yml");
    expect(sub.content).toContain("cordis");
    expect(sub.content).toContain("evolve");
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256("AGENTS.md");
    await a.writeSubstrate("dsh/AGENTS.md", "# mutated\n");
    expect(repo.sha256("AGENTS.md")).toBe(before);
  });

  it("readTrajectories groups event streams by sessionId into Trajectory[]", async () => {
    const a = newAdapter(repo.root, DSH_EVENTS); // dshHome 指向 events 目录（递归扫 *.jsonl）
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).toContain("dsh-fail-1");
    expect(ids).toContain("dsh-fail-2");
  });

  it("readTrajectories extracts diagnosis via extractDiagnosis first (TL-T01-compatible)", async () => {
    const a = newAdapter(repo.root, DSH_EVENTS);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "dsh-fail-1");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories falls back to dsh-private error fields", async () => {
    const a = newAdapter(repo.root, DSH_EVENTS);
    const trajs = await a.readTrajectories("any-sha");
    // dsh-fail-2 用私有 is_error/content（非 TL-T01 同构）→ 兜底提取
    const fail2 = trajs.find((t) => t.sessionId === "dsh-fail-2");
    expect(fail2).toBeDefined();
    expect(fail2!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories skips malformed JSONL lines without throwing", async () => {
    const a = newAdapter(repo.root, DSH_EVENTS);
    const trajs = await a.readTrajectories("any-sha");
    const mal = trajs.find((t) => t.sessionId === "dsh-mal-1");
    expect(mal).toBeDefined();
    expect(mal!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories skips sessions without error signal", async () => {
    const a = newAdapter(repo.root, DSH_EVENTS);
    const trajs = await a.readTrajectories("any-sha");
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("dsh-ok-1");
  });

  it("readTrajectories returns [] when dshHome missing", async () => {
    const a = newAdapter(repo.root, join(FIXTURES, "no-dsh-home"));
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("deploy bumps version + git commits + syncs profile patch + prints restart hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("dsh/AGENTS.md", "# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/restart dsh|new session/i);
  });

  it("rollback git-checkouts and reverse-syncs profile patch", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("dsh/AGENTS.md", "# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read("AGENTS.md")).not.toContain("mutated");
  });

  it("llmPort is pass-through from opts", () => {
    const llm = new FakeLLM("improve");
    const a = new DshAdapter({
      dshHome: DSH_HOME,
      profile: "default",
      repoRoot: repo.root,
      llmPort: llm,
    });
    expect(a.llmPort).toBe(llm);
  });

  it("createDshPlugin returns a HarnessPort", () => {
    const port = createDshPlugin({
      dshHome: DSH_HOME,
      profile: "default",
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when AGENTS.md missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("dsh/missing.md")).rejects.toThrow(/substrate not found/i);
  });

  it("eventStreamToTrajectory returns null for non-failed stream", () => {
    const r = eventStreamToTrajectory("no-fail", [
      { type: "message", sessionId: "no-fail", payload: { text: "ok" } },
    ]);
    expect(r).toBeNull();
  });

  it("readDshTrajectories standalone function reads events dir", () => {
    const trajs = readDshTrajectories(DSH_EVENTS, "sha-x");
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
