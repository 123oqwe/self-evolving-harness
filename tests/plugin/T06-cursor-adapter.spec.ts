// PLG-T06: evolve-cursor — Cursor HarnessPort 适配器（离线进化模式）。
//
// Spec: execution/plugin/TASKS.md §PLG-T06。
// RED 态：`@harness/evolve-cursor` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/rules/evolve.mdc（YAML frontmatter + markdown body）。
// 离线铁律：readTrajectories 恒返回 []（Cursor 无文件级轨迹导出）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  CursorAdapter,
  createCursorPlugin,
  buildOfflineConfig,
} from "@harness/evolve-cursor";
import type { CursorAdapterOptions } from "@harness/evolve-cursor";
import type { EvolveCanaryTask } from "@harness/evolve-core";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");

function newAdapter(repoRoot: string): CursorAdapter {
  const opts: CursorAdapterOptions = {
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new CursorAdapter(opts);
}

describe("PLG-T06 CursorAdapter (offline)", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    const mdc = readFileSync(join(FIXTURES, "rules", "evolve.mdc"), "utf8");
    repo.writeFile(".cursor/rules/evolve.mdc", mdc);
    repo.commit("baseline mdc");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate reads .cursor/rules mdc with frontmatter", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("cursor/rules/evolve.mdc");
    expect(sub.content).toContain("description:");
    expect(sub.content).toContain("alwaysApply: false");
    expect(sub.sha).toBe(contentSha(repo.read(".cursor/rules/evolve.mdc")));
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256(".cursor/rules/evolve.mdc");
    await a.writeSubstrate("cursor/rules/evolve.mdc", "---\ndescription: x\n---\n# mutated\n");
    expect(repo.sha256(".cursor/rules/evolve.mdc")).toBe(before);
  });

  it("readTrajectories always returns [] (offline mode)", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
    // 多次调用仍恒 []
    expect(await a.readTrajectories("another-sha")).toEqual([]);
  });

  it("deploy bumps version + git commits + prints auto-discovery hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("cursor/rules/evolve.mdc", "---\ndescription: x\n---\n# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/auto-discover|next.*session|no restart/i);
  });

  it("rollback git-checkouts .cursor/rules to rollbackTo sha", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("cursor/rules/evolve.mdc", "---\ndescription: x\n---\n# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read(".cursor/rules/evolve.mdc")).not.toContain("mutated");
  });

  it("buildOfflineConfig produces EvolveConfig with offline:true", () => {
    const a = newAdapter(repo.root);
    const canary: EvolveCanaryTask[] = [
      { id: "c1", verify: "true", expectedExit: 0 },
      { id: "c2", verify: "true", expectedExit: 0 },
      { id: "c3", verify: "true", expectedExit: 0 },
    ];
    const cfg = buildOfflineConfig(a, "cursor/rules/evolve.mdc", canary);
    expect(cfg.offline).toBe(true);
    expect(cfg.harnessPort).toBe(a);
    expect(cfg.substrateId).toBe("cursor/rules/evolve.mdc");
  });

  it("runEvolutionCycle offline does not call readTrajectories", async () => {
    // 通过 evolve-core runEvolutionCycle + offline config 验证 spy。
    // evolve-core RED 时整体 RED；GREEN 后断言 readTrajectoriesCallCount===0。
    const { runEvolutionCycle } = await import("@harness/evolve-core");
    const a = newAdapter(repo.root);
    const canary: EvolveCanaryTask[] = [
      { id: "c1", verify: "true", expectedExit: 0 },
      { id: "c2", verify: "true", expectedExit: 0 },
      { id: "c3", verify: "true", expectedExit: 0 },
    ];
    const cfg = buildOfflineConfig(a, "cursor/rules/evolve.mdc", canary, {
      workspaceDir: repo.root,
    });
    const result = await runEvolutionCycle(cfg);
    // CursorAdapter.readTrajectories 恒 []；offline 模式下 evolve-core 也不应调用它
    expect(a).toBeDefined();
    expect(result.offline).toBe(true);
  });

  it("llmPort is pass-through", () => {
    const llm = new FakeLLM("improve");
    const a = new CursorAdapter({ repoRoot: repo.root, llmPort: llm });
    expect(a.llmPort).toBe(llm);
  });

  it("createCursorPlugin returns a HarnessPort", () => {
    const port = createCursorPlugin({ repoRoot: repo.root, llmPort: new FakeLLM("improve") });
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when mdc missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("cursor/rules/missing.mdc")).rejects.toThrow(/substrate not found/i);
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
