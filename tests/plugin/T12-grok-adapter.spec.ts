// PLG-T12: evolve-grok — Grok Build HarnessPort 适配器（薄委托 ClaudeCodeAdapter + grok 插件目录）。
//
// Spec: execution/plugin/TASKS.md §PLG-T12。
// RED 态：`@harness/evolve-grok` 包未实现 → import 失败 = 合法 RED。
// fixture：tests/plugin/fixtures/grok-plugins/evolve/{skills,evolve/SKILL.md, hooks/hooks.json, .mcp.json}
// 轨迹未核实 → offline 降级（readTrajectories 恒 []）；核实后注入 sessionLogPath 才解析。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { contentSha } from "@harness/adapters";
import {
  GrokAdapter,
  createGrokPlugin,
  renderGrokPluginDir,
  renderHooksJson,
} from "@harness/evolve-grok";
import type { GrokAdapterOptions, GrokPluginDirSpec } from "@harness/evolve-grok";

const FIXTURES = join(process.cwd(), "tests", "plugin", "fixtures");
const GROK_PLUGINS = join(FIXTURES, "grok-plugins");

function newAdapter(repoRoot: string, sessionLogPath?: string): GrokAdapter {
  const opts: GrokAdapterOptions = {
    repoRoot,
    claudeHome: join(repoRoot, ".claude-home"),
    llmPort: new FakeLLM("improve"),
    ...(sessionLogPath !== undefined ? { sessionLogPath } : {}),
  };
  return new GrokAdapter(opts);
}

describe("PLG-T12 GrokAdapter", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string; sha256: (p: string) => string; head: () => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("CLAUDE.md", "# grok+claude instructions\n");
    repo.writeFile("AGENTS.md", "# agents\n");
    repo.writeFile(".claude/rules/x.md", "# rule x\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  it("readSubstrate delegates claude-compat ids to ClaudeCodeAdapter", async () => {
    const a = newAdapter(repo.root);
    const claude = await a.readSubstrate("grok/claude/CLAUDE.md");
    expect(claude.content).toContain("grok+claude instructions");
    const agents = await a.readSubstrate("grok/claude/AGENTS.md");
    expect(agents.content).toContain("agents");
    const rule = await a.readSubstrate("grok/claude/.claude/rules/x.md");
    expect(rule.content).toContain("rule x");
  });

  it("readSubstrate reads grok plugins dir ids", async () => {
    const a = newAdapter(repo.root);
    // grok-plugin fixture 拷进 repo
    copyGrokPlugins(repo.root);
    const skill = await a.readSubstrate("grok/plugins/evolve/skills/evolve/SKILL.md");
    expect(skill.content).toContain("name: evolve");
    const hooks = await a.readSubstrate("grok/plugins/evolve/hooks/hooks.json");
    expect(hooks.content).toContain("PreToolUse");
  });

  it("renderGrokPluginDir produces skills/hooks.json/.mcp.json", () => {
    const spec: GrokPluginDirSpec = {
      skills: [{ name: "evolve", body: "# evolve skill\n" }],
      preToolUseHooks: [
        { matcher: "Write|Edit|Bash", command: "lock tests/**/*.spec.ts" },
      ],
      mcp: { mcpServers: { evolve: { command: "evolve", args: ["mcp"] } } },
    };
    const files = renderGrokPluginDir(spec);
    const paths = [...files.keys()];
    expect(paths.find((p) => p.includes("skills") && p.endsWith("SKILL.md"))).toBeTruthy();
    expect(paths.find((p) => p.endsWith("hooks.json"))).toBeTruthy();
    expect(paths.find((p) => p.endsWith(".mcp.json"))).toBeTruthy();
  });

  it("renderHooksJson pre-tool-use hook protects tests/**/*.spec.ts (exam-lock parity)", () => {
    const hooks = [
      { matcher: "Write|Edit|Bash", command: "grep tests/**/*.spec.ts && exit 2 || exit 0" },
    ];
    const json = renderHooksJson(hooks);
    expect(json).toContain("PreToolUse");
    expect(json).toMatch(/tests\/\*\*\/\*\.spec\.ts/);
  });

  it("renderHooksJson throws InvalidHooksError on empty hooks", () => {
    expect(() => renderHooksJson([])).toThrow(/invalid.*hooks|empty.*hooks|hooks/i);
  });

  it("writeSubstrate grok-plugin id lands in staging, active untouched", async () => {
    const a = newAdapter(repo.root);
    copyGrokPlugins(repo.root);
    const before = repo.sha256(".grok/plugins/evolve/hooks/hooks.json");
    await a.writeSubstrate("grok/plugins/evolve/hooks/hooks.json", '{"PreToolUse":[]}');
    expect(repo.sha256(".grok/plugins/evolve/hooks/hooks.json")).toBe(before);
  });

  it("readTrajectories returns [] when sessionLogPath unverified (offline)", async () => {
    const a = newAdapter(repo.root); // 无 sessionLogPath
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs).toEqual([]);
  });

  it("readTrajectories parses jsonl when sessionLogPath provided", async () => {
    // 构造一个临时 jsonl 轨迹文件（含 error 信号）
    const trajDir = join(repo.root, ".grok", "sessions");
    mkdirSync(trajDir, { recursive: true });
    writeFileSync(
      join(trajDir, "grok-fail-1.jsonl"),
      `{"type":"agent","sessionId":"grok-fail-1","content":{"is_error":true,"error":"Error: grok failure"}}\n`,
    );
    const a = newAdapter(repo.root, join(trajDir, "grok-fail-1.jsonl"));
    const trajs = await a.readTrajectories("any-sha");
    expect(trajs.length).toBeGreaterThan(0);
    const fail = trajs.find((t) => t.sessionId === "grok-fail-1");
    expect(fail).toBeDefined();
    expect(fail!.failed).toBe(true);
  });

  it("deploy git commits repoRoot including .grok/plugins and prints hint", async () => {
    const a = newAdapter(repo.root);
    copyGrokPlugins(repo.root);
    repo.commit("add grok plugins");
    const staged = await a.writeSubstrate("grok/plugins/evolve/skills/evolve/SKILL.md", "# mutated skill\n");
    const headBefore = repo.head();
    const out = await captureStdout(() => a.deploy(staged.sha));
    expect(repo.head()).not.toBe(headBefore);
    expect(out).toMatch(/next.*session|effective|grok/i);
  });

  it("rollback git-checkouts to rollbackTo sha", async () => {
    const a = newAdapter(repo.root);
    copyGrokPlugins(repo.root);
    repo.commit("add grok plugins");
    const baselineHead = repo.head();
    const staged = await a.writeSubstrate("grok/plugins/evolve/skills/evolve/SKILL.md", "# mutated skill\n");
    await a.deploy(staged.sha);
    await a.rollback(baselineHead);
    expect(repo.read(".grok/plugins/evolve/skills/evolve/SKILL.md")).not.toContain("mutated skill");
  });

  it("llmPort is pass-through", () => {
    const llm = new FakeLLM("improve");
    const a = new GrokAdapter({ repoRoot: repo.root, claudeHome: "/tmp/x", llmPort: llm });
    expect(a.llmPort).toBe(llm);
  });

  it("createGrokPlugin returns a HarnessPort", () => {
    const port = createGrokPlugin({
      repoRoot: repo.root,
      claudeHome: "/tmp/x",
      llmPort: new FakeLLM("improve"),
    });
    expect(typeof port.readSubstrate).toBe("function");
  });

  it("readSubstrate throws SubstrateNotFoundError when missing", async () => {
    const a = newAdapter(repo.root);
    await expect(a.readSubstrate("grok/claude/missing.md")).rejects.toThrow(/substrate not found/i);
  });
});

function copyGrokPlugins(repoRoot: string): void {
  const dest = join(repoRoot, ".grok", "plugins", "evolve");
  mkdirSync(join(dest, "skills", "evolve"), { recursive: true });
  mkdirSync(join(dest, "hooks"), { recursive: true });
  const { readFileSync, writeFileSync: wfs } = require("node:fs");
  wfs(join(dest, "skills", "evolve", "SKILL.md"), readFileSync(join(GROK_PLUGINS, "evolve", "skills", "evolve", "SKILL.md")));
  wfs(join(dest, "hooks", "hooks.json"), readFileSync(join(GROK_PLUGINS, "evolve", "hooks", "hooks.json")));
  wfs(join(dest, ".mcp.json"), readFileSync(join(GROK_PLUGINS, "evolve", ".mcp.json")));
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

void contentSha;
void writeFileSync;
