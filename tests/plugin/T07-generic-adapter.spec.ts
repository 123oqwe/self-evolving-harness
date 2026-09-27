// PLG-T07: evolve-generic — YAML 声明式通用适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T07。
// RED 态：`@harness/evolve-generic` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/generic/*.adapter.yaml + {events/*.jsonl, sessions.json, sqlite-harness.db, AGENTS.md}
// 4 格式分发：jsonl/json/sqlite/none；diagnosisFields OR 匹配；verified:false 不阻断构造。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import {
  GenericAdapter,
  createGenericPlugin,
  loadGenericConfig,
  parseTrajectories,
} from "@harness/evolve-generic";
import type { GenericAdapterConfig, GenericAdapterOptions } from "@harness/evolve-generic";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures", "generic");
const EXAMPLES = join(process.cwd(), "packages", "evolve-generic", "examples");

function yamlPath(name: string): string {
  return join(FIXTURES, name);
}

describe("PLG-T07 evolve-generic loadGenericConfig", () => {
  it("parses valid yaml", () => {
    const cfg = loadGenericConfig(yamlPath("jsonl-harness.adapter.yaml"));
    expect(cfg.harnessId).toBe("jsonl-harness");
    expect(cfg.verified).toBe(true);
    expect(cfg.trajectory.format).toBe("jsonl");
    expect(cfg.trajectory.diagnosisFields).toContain("is_error");
  });

  it("throws InvalidGenericConfigError on missing harnessId", () => {
    expect(() => loadGenericConfig(yamlPath("invalid-missing-id.adapter.yaml"))).toThrow(
      /invalid.*config|missing.*harnessId|harnessId/i,
    );
  });

  it("throws on invalid format enum", () => {
    expect(() => loadGenericConfig(yamlPath("invalid-bad-format.adapter.yaml"))).toThrow(
      /format|invalid/i,
    );
  });

  it("grokbuild.adapter.yaml example loads without error", () => {
    const cfg = loadGenericConfig(join(EXAMPLES, "grokbuild.adapter.yaml"));
    expect(cfg.harnessId).toBe("grokbuild");
    expect(cfg.verified).toBe(false); // 调研未核实占位
  });

  it("dsh.adapter.yaml example loads without error", () => {
    const cfg = loadGenericConfig(join(EXAMPLES, "dsh.adapter.yaml"));
    expect(cfg.harnessId).toBe("dsh");
    expect(cfg.verified).toBe(false);
  });
});

describe("PLG-T07 GenericAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("AGENTS.md", "# baseline\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  function adapterWith(cfg: GenericAdapterConfig, repoRoot: string): GenericAdapter {
    const opts: GenericAdapterOptions = { config: cfg, llmPort: new FakeLLM("improve") };
    return new GenericAdapter(opts);
  }

  it("readSubstrate maps id via pathMap", async () => {
    const cfg = loadGenericConfig(yamlPath("jsonl-harness.adapter.yaml"));
    // diskRoot 指向 fixture 目录（含 AGENTS.md）
    const cfgAbs: GenericAdapterConfig = { ...cfg, substrate: { ...cfg.substrate, diskRoot: FIXTURES, repoRoot: repo.root } };
    const a = adapterWith(cfgAbs, repo.root);
    const sub = await a.readSubstrate("jsonl-harness/AGENTS.md");
    expect(sub.content).toContain("generic harness agents");
  });

  it("readTrajectories parses jsonl format", async () => {
    const cfg = loadGenericConfig(yamlPath("jsonl-harness.adapter.yaml"));
    const cfgAbs: GenericAdapterConfig = { ...cfg, trajectory: { ...cfg.trajectory, path: join(FIXTURES, "events") } };
    const a = adapterWith(cfgAbs, repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "gen-jsonl-1");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories parses json format", async () => {
    const cfg = loadGenericConfig(yamlPath("json-harness.adapter.yaml"));
    const cfgAbs: GenericAdapterConfig = { ...cfg, trajectory: { ...cfg.trajectory, path: join(FIXTURES, "sessions.json") } };
    const a = adapterWith(cfgAbs, repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "j-fail-1");
    expect(fail).toBeDefined();
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories parses sqlite format", async () => {
    const cfg = loadGenericConfig(yamlPath("sqlite-harness.adapter.yaml"));
    const cfgAbs: GenericAdapterConfig = { ...cfg, trajectory: { ...cfg.trajectory, path: join(FIXTURES, "sqlite-harness.db") } };
    const a = adapterWith(cfgAbs, repo.root);
    const trajs = await a.readTrajectories("any-sha");
    const fail = trajs.find((t) => t.sessionId === "gen-fail-1");
    expect(fail).toBeDefined();
    expect(fail!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories returns [] for none format", async () => {
    const cfg = loadGenericConfig(yamlPath("none-harness.adapter.yaml"));
    const a = adapterWith(cfg, repo.root);
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("deploy git commits + syncs + prints restartHint", async () => {
    const cfg = loadGenericConfig(yamlPath("jsonl-harness.adapter.yaml"));
    const cfgAbs: GenericAdapterConfig = { ...cfg, substrate: { ...cfg.substrate, diskRoot: FIXTURES, repoRoot: repo.root }, deploy: { ...cfg.deploy, syncTarget: repo.root } };
    const a = adapterWith(cfgAbs, repo.root);
    const staged = await a.writeSubstrate("jsonl-harness/AGENTS.md", "# mutated\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/restart/i);
  });

  it("verified:false config still constructs adapter", () => {
    // 模拟 verified:false（grokbuild 示例形态）
    const fakeCfg: GenericAdapterConfig = {
      harnessId: "unverified",
      verified: false,
      substrate: { idPrefix: "unverified/", diskRoot: repo.root, repoRoot: repo.root, pathMap: { "AGENTS.md": "AGENTS.md" } },
      trajectory: { format: "none", path: "", diagnosisFields: [] },
      deploy: { restartHint: "restart" },
      llm: { passThrough: true },
    };
    expect(() => adapterWith(fakeCfg, repo.root)).not.toThrow();
  });

  it("createGenericPlugin returns a HarnessPort", () => {
    const port = createGenericPlugin(yamlPath("none-harness.adapter.yaml"), new FakeLLM("improve"));
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("parseTrajectories standalone dispatches by format", () => {
    const cfg = loadGenericConfig(yamlPath("jsonl-harness.adapter.yaml"));
    const trajs = parseTrajectories({ ...cfg.trajectory, path: join(FIXTURES, "events") }, "sha");
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

void mkdirSync;
void writeFileSync;
