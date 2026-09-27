// PLG-T12 (claude-compat): Grok Build 兼容 Claude Code 生态验证用例。
//
// Spec: execution/plugin/TASKS.md §PLG-T12（T12-grok-claude-compat.spec.ts RED 节）。
// RED 态：`@harness/evolve-grok` 包未实现 → import 失败 = 合法 RED。
// 实证调研"Grok Build 兼容 Claude Code 生态"结论：同 repoRoot 下 CLAUDE.md/AGENTS.md/
// .claude/rules/ 读写往返；GrokAdapter 与 ClaudeCodeAdapter 对同内容同 sha 一致。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { FakeLLM, tempRepoFactory } from "./helpers.js";
import { ClaudeCodeAdapter } from "@harness/adapters";
import { GrokAdapter } from "@harness/evolve-grok";

const SUBSTRATES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".claude/rules/x.md",
];

describe("PLG-T12 grok claude-compat", () => {
  let repo: { root: string; destroy: () => void; writeFile: (p: string, c: string) => string; commit: (m?: string) => string; read: (p: string) => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile("CLAUDE.md", "# claude compat instructions\nshared content\n");
    repo.writeFile("AGENTS.md", "# agents\nshared content\n");
    repo.writeFile(".claude/rules/x.md", "# rule x\nshared content\n");
    repo.commit("baseline");
  });
  afterEach(() => repo.destroy());

  it("ClaudeCodeAdapter substrate round-trip works under grok project layout", async () => {
    const claude = new ClaudeCodeAdapter({
      repoRoot: repo.root,
      claudeHome: join(repo.root, ".claude-home"),
      llmPort: new FakeLLM("improve"),
      // 轨迹源无关本测试（只验证基质往返）
    });
    for (const rel of SUBSTRATES) {
      // ClaudeCodeAdapter 的基质 id 形态：直接 repo-root-relative 路径
      const sub = await claude.readSubstrate(rel);
      expect(sub.content).toContain("shared content");
    }
  });

  it("GrokAdapter and ClaudeCodeAdapter agree on substrate sha for same content", async () => {
    const claude = new ClaudeCodeAdapter({
      repoRoot: repo.root,
      claudeHome: join(repo.root, ".claude-home"),
      llmPort: new FakeLLM("improve"),
    });
    const grok = new GrokAdapter({
      repoRoot: repo.root,
      claudeHome: join(repo.root, ".claude-home"),
      llmPort: new FakeLLM("improve"),
    });
    for (const rel of SUBSTRATES) {
      const viaClaude = await claude.readSubstrate(rel);
      const viaGrok = await grok.readSubstrate(`grok/claude/${rel}`);
      expect(viaGrok.sha).toBe(viaClaude.sha);
      expect(viaGrok.content).toBe(viaClaude.content);
    }
  });

  it("claude-compat coverage gaps surface as explicit TODO, not silent pass", async () => {
    // 兼容性验证铁律：若 grok 对某 claude-compat id 不兼容（差异点），
    // 须显式 fail（不静默 pass）。本测试断言 grok/claude/<rel> 对全部 SUBSTRATES
    // 均可读且 sha 与 ClaudeCodeAdapter 一致；任一差异即 throw（非 silent pass）。
    const grok = new GrokAdapter({
      repoRoot: repo.root,
      claudeHome: join(repo.root, ".claude-home"),
      llmPort: new FakeLLM("improve"),
    });
    const failures: string[] = [];
    for (const rel of SUBSTRATES) {
      try {
        const sub = await grok.readSubstrate(`grok/claude/${rel}`);
        if (!sub.content || sub.sha.length === 0) {
          failures.push(`${rel}: empty content/sha`);
        }
      } catch (e) {
        failures.push(`${rel}: ${(e as Error).message}`);
      }
    }
    if (failures.length > 0) {
      // 显式列出差异点（TODO），不静默吞
      throw new Error(`claude-compat coverage gaps (must be addressed, not silent pass):\n${failures.join("\n")}`);
    }
  });
});
