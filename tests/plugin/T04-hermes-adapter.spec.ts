// PLG-T04: evolve-hermes — Hermes Agent HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T04。
// RED 态：`@harness/evolve-hermes` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/hermes-home/{skills/evolve/SKILL.md, state.db}
// （state.db = SQLite，sessions + messages 表，部分 session 含 is_error 消息）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  HermesAdapter,
  createHermesPlugin,
  buildCronJobSpec,
} from "@harness/evolve-hermes";
import type { HermesAdapterOptions, CronTriggerOptions } from "@harness/evolve-hermes";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const HERMES_HOME = join(FIXTURES, "hermes-home");

// HermesAdapter.deploy/rollback 把 repoRoot active 内容同步回 hermesHome/skills/
// （spec §PLG-T04 行为规范：deploy 后同步 hermesHome + mtime 半热加载）。测试把共享
// 提交 fixture `hermes-home` 当作 hermesHome 注入 → 真实 sync 会在测试运行中改写该
// fixture。虽 hermes 断言对污染耐受（仍绿），但 fixture 残留改动违反"测试后无残留"。
// 模块加载时快照整个 hermes-home fixture，afterEach 恢复 → 测试隔离 + fixture 干净。
const HERMES_HOME_SNAPSHOT = mkdtempSync(join(tmpdir(), "hermes-home-snap-"));
if (existsSync(HERMES_HOME)) {
  cpSync(HERMES_HOME, join(HERMES_HOME_SNAPSHOT, "home"), { recursive: true });
}

function newAdapter(repoRoot: string, hermesHome = HERMES_HOME): HermesAdapter {
  const opts: HermesAdapterOptions = {
    hermesHome,
    repoRoot,
    llmPort: new FakeLLM("improve"),
  };
  return new HermesAdapter(opts);
}

describe("PLG-T04 HermesAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("skills/evolve/SKILL.md", "---\nname: evolve\n---\n# baseline\n");
    repo.commit("baseline");
  });
  afterEach(() => {
    repo.destroy();
    // 恢复 hermesHome fixture（deploy/rollback 的真实 sync 不残留污染）。
    if (existsSync(HERMES_HOME)) {
      rmSync(HERMES_HOME, { recursive: true, force: true });
      cpSync(join(HERMES_HOME_SNAPSHOT, "home"), HERMES_HOME, { recursive: true });
    }
  });

  it("readSubstrate reads hermesHome skills SKILL.md with frontmatter", async () => {
    const a = newAdapter(repo.root);
    const sub = await a.readSubstrate("hermes/skills/evolve/SKILL.md");
    expect(sub.content).toContain("name: evolve");
    expect(sub.sha).toBe(contentSha(readFile(HERMES_HOME, "skills/evolve/SKILL.md")));
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    const before = repo.sha256("skills/evolve/SKILL.md");
    await a.writeSubstrate("hermes/skills/evolve/SKILL.md", "# mutated\n");
    expect(repo.sha256("skills/evolve/SKILL.md")).toBe(before);
  });

  it("readTrajectories reads state.db sessions into Trajectory[]", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs.length).toBeGreaterThan(0);
    const fail = trajs.find((t) => t.sessionId === "sess-fail-1");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
  });

  it("readTrajectories extracts diagnosis from error messages", async () => {
    const a = newAdapter(repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "sess-fail-1");
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
    // non-failed session 不入结果
    const ids = trajs.map((t) => t.sessionId);
    expect(ids).not.toContain("sess-ok-1");
  });

  it("readTrajectories returns [] when state.db missing", async () => {
    const a = newAdapter(repo.root, join(FIXTURES, "no-hermes-home"));
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("readTrajectories returns [] when state.db not sqlite (corrupt)", async () => {
    // 构造一个 corrupt hermesHome：state.db 为纯文本
    const repo2 = tempRepoFactory();
    const corruptHome = join(repo2.root, "hermes");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(corruptHome, "skills", "evolve"), { recursive: true });
    writeFileSync(join(corruptHome, "state.db"), "NOT A DATABASE");
    const a = new HermesAdapter({
      hermesHome: corruptHome,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
    repo2.destroy();
  });

  it("deploy bumps version + git commits + syncs hermesHome + prints semi-hot-reload hint", async () => {
    const a = newAdapter(repo.root);
    const staged = await a.writeSubstrate("hermes/skills/evolve/SKILL.md", "# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/semi-hot|mtime|next query/i);
  });

  it("rollback git-checkouts + syncs hermesHome skills", async () => {
    const a = newAdapter(repo.root);
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("hermes/skills/evolve/SKILL.md", "# mutated\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read("skills/evolve/SKILL.md")).not.toContain("mutated");
  });

  it("buildCronJobSpec produces hermes-cron-compatible job definition", () => {
    const opts: CronTriggerOptions = {
      schedule: "0 9 * * *",
      workdir: repo.root,
      skills: ["evolve"],
    };
    const job = buildCronJobSpec(opts) as Record<string, unknown>;
    expect(job.schedule).toBe("0 9 * * *");
    expect(job.workdir).toBe(repo.root);
    expect(job.skills).toEqual(["evolve"]);
  });

  it("buildCronJobSpec throws on invalid schedule", () => {
    expect(() =>
      buildCronJobSpec({
        schedule: "not a schedule",
        workdir: repo.root,
        skills: ["evolve"],
      } as CronTriggerOptions),
    ).toThrow(/invalid.*schedule|schedule/i);
  });

  it("llmPort is pass-through", () => {
    const llm = new FakeLLM("improve");
    const a = new HermesAdapter({
      hermesHome: HERMES_HOME,
      repoRoot: repo.root,
      llmPort: llm,
    });
    expect(a.llmPort).toBe(llm);
  });

  it("createHermesPlugin returns a HarnessPort", () => {
    const port = createHermesPlugin({
      hermesHome: HERMES_HOME,
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
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
