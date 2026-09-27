// PLG-T08: 统一 CLI（evolve init/run/status + registry）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08。
// RED 态：`@harness/evolve-cli` 包未实现 → import 失败 = 合法 RED。
// 测试：temp repo + FakePluginFactory 注入（绕过真实插件装配）+ evolve.yaml/evolve-state.json 读写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import {
  runInit,
  runRun,
  runStatus,
  loadRegistry,
  SUPPORTED_HARNESS,
} from "@harness/evolve-cli";
import type { InitOptions, RunOptions } from "@harness/evolve-cli";
import type { EvolvePluginFactory } from "@harness/evolve-core";

describe("PLG-T08 evolve CLI", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("AGENTS.md", "# baseline\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  it("runInit writes .harness/evolve.yaml for codex", async () => {
    const opts: InitOptions = { harness: "codex" };
    await runInit(opts, repo.root);
    const cfgPath = join(repo.root, ".harness", "evolve.yaml");
    expect(existsSync(cfgPath)).toBe(true);
    const text = readFileSync(cfgPath, "utf8");
    expect(text).toMatch(/harness:\s*codex/);
    expect(text).toMatch(/substrateId:\s*codex\/AGENTS\.md/);
    expect(text).toMatch(/canaryGlob:/);
  });

  it("runInit writes evolve.yaml with adapterYaml for generic", async () => {
    const opts: InitOptions = {
      harness: "generic",
      adapterYaml: "/path/to/grokbuild.adapter.yaml",
    };
    await runInit(opts, repo.root);
    const text = readFileSync(join(repo.root, ".harness", "evolve.yaml"), "utf8");
    expect(text).toMatch(/harness:\s*generic/);
    expect(text).toMatch(/adapterYaml:/);
  });

  it("runInit throws UnsupportedHarnessError for unknown harness", async () => {
    await expect(runInit({ harness: "unknown-harness" }, repo.root)).rejects.toThrow(
      /unsupported.*harness|unsupported-harness/i,
    );
  });

  it("loadRegistry contains all SUPPORTED_HARNESS ids", () => {
    const reg = loadRegistry();
    for (const id of SUPPORTED_HARNESS) {
      expect(reg.has(id)).toBe(true);
    }
    expect(SUPPORTED_HARNESS).toContain("codex");
    expect(SUPPORTED_HARNESS).toContain("generic");
  });

  it("runRun assembles HarnessPort from registry and runs cycle (FakePluginFactory)", async () => {
    // scaffold evolve.yaml + canary
    await runInit({ harness: "codex" }, repo.root);
    const canaryDir = join(repo.root, ".harness", "canary");
    mkdirSync(canaryDir, { recursive: true });
    writeFileSync(join(canaryDir, "c1.yaml"), "id: c1\nverify: 'true'\nexpectedExit: 0\n");
    writeFileSync(join(canaryDir, "c2.yaml"), "id: c2\nverify: 'true'\nexpectedExit: 0\n");
    writeFileSync(join(canaryDir, "c3.yaml"), "id: c3\nverify: 'true'\nexpectedExit: 0\n");

    // 注入 FakePluginFactory（测试用 env hook / registry override）
    const fakeFactory: EvolvePluginFactory = {
      harnessId: "codex",
      create(_opts: Record<string, unknown>) {
        // 返回一个最小 HarnessPort 形状（实际由 evolve-core 类型约束）
        return {
          readSubstrate: async () => ({ id: "codex/AGENTS.md", kind: "prompt", content: "# x\n", sha: "x" }),
          writeSubstrate: async () => ({ id: "codex/AGENTS.md", kind: "prompt", content: "# y\n", sha: "y" }),
          readTrajectories: async () => [],
          deploy: async () => ({ version: "v1", sha: "zzz", rollbackTo: "rrr" }),
          rollback: async () => {},
          llmPort: new FakeLLM("improve"),
        } as never;
      },
    };
    const opts: RunOptions = {};
    const result = await runRunWithFactory(repo.root, opts, fakeFactory);
    expect(result).toBeDefined();
    expect(typeof result.retainedMutants).toBe("number");
  });

  it("runRun writes evolve-state.json with EvolveResult", async () => {
    await runInit({ harness: "codex" }, repo.root);
    const canaryDir = join(repo.root, ".harness", "canary");
    mkdirSync(canaryDir, { recursive: true });
    for (const id of ["c1", "c2", "c3"]) {
      writeFileSync(join(canaryDir, `${id}.yaml`), `id: ${id}\nverify: 'true'\nexpectedExit: 0\n`);
    }
    const fakeFactory: EvolvePluginFactory = {
      harnessId: "codex",
      create() {
        return {
          readSubstrate: async () => ({ id: "codex/AGENTS.md", kind: "prompt", content: "# x\n", sha: "x" }),
          writeSubstrate: async () => ({ id: "codex/AGENTS.md", kind: "prompt", content: "# y\n", sha: "y" }),
          readTrajectories: async () => [],
          deploy: async () => ({ version: "v1", sha: "zzz", rollbackTo: "rrr" }),
          rollback: async () => {},
          llmPort: new FakeLLM("improve"),
        } as never;
      },
    };
    await runRunWithFactory(repo.root, {}, fakeFactory);
    const statePath = join(repo.root, ".harness", "evolve-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state).toHaveProperty("retainedMutants");
    expect(state).toHaveProperty("offline");
  });

  it("runRun throws EvolveConfigNotFoundError when evolve.yaml missing", async () => {
    await expect(runRun({}, repo.root)).rejects.toThrow(/config.*not.*found|evolve\.yaml/i);
  });

  it("runStatus prints retain/committed/canary from state", async () => {
    const stateDir = join(repo.root, ".harness");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "evolve-state.json"),
      JSON.stringify({
        retainedMutants: 2,
        committed: { sha: "abc123", origin: "test" },
        canaryRelease: { decision: "PROMOTE", variantSha: "vvv" },
        revertEvent: null,
        baselineResolveRate: 0.5,
        postRevertResolveRate: 0.5,
        retain: 2,
        offline: false,
      }),
    );
    const out = await captureStdout(() => runStatus(repo.root));
    expect(out).toMatch(/retain/i);
    expect(out).toMatch(/abc123|commit/i);
    expect(out).toMatch(/PROMOTE|canary/i);
  });

  it("runStatus prints no-evolution-yet when state missing", async () => {
    const out = await captureStdout(() => runStatus(repo.root));
    expect(out).toMatch(/no evolution run yet|no-evolution/i);
  });

  it("cli --help exits 0", async () => {
    const { runCli } = await import("@harness/evolve-cli");
    const code = await runCli(["--help"], repo.root);
    expect(code).toBe(0);
  });
});

// 测试注入 FakePluginFactory 的 runRun 变体（绕过真实 registry 装配）。
// 歧义：spec 未声明 runRun 接受 factory 注入参数；此处假设一个测试专用入口
// runRunWithFactory（ambiguity 记录）。GREEN 实现者可暴露测试 hook。
async function runRunWithFactory(
  cwd: string,
  opts: RunOptions,
  factory: EvolvePluginFactory,
): Promise<{ retainedMutants: number; offline: boolean }> {
  const mod = await import("@harness/evolve-cli");
  const fn = (mod as Record<string, unknown>).runRunWithFactory as
    | undefined
    | ((cwd: string, opts: RunOptions, factory: EvolvePluginFactory) => Promise<{ retainedMutants: number; offline: boolean }>);
  if (typeof fn === "function") {
    return fn(cwd, opts, factory);
  }
  // 回退：直接调 runRun（GREEN 实现者须提供测试注入入口，否则此分支 RED）
  return runRun(opts, cwd);
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
