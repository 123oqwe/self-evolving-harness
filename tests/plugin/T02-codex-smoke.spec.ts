// PLG-T02 (smoke): evolve-codex 真实 CODEX_HOME 往返。
//
// Spec: execution/plugin/TASKS.md §PLG-T02 + §0.5（真实往返 smoke 用环境探针门控）。
// 环境探针：CODEX_HOME 存在（existsSync）或 `command -v codex` 可达。无环境 skip，exit 0 不红。

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { FakeLLM, which } from "./helpers.js";
import { CodexAdapter } from "@harness/evolve-codex";

const codexHomeCandidate =
  process.env.CODEX_HOME ?? join(homedir(), ".codex");

const hasCodex =
  existsSync(codexHomeCandidate) || which("codex").exitCode === 0;

describe.skipIf(!hasCodex)("PLG-T02 codex smoke (real CODEX_HOME)", () => {
  it("parses real rollout JSONL from CODEX_HOME without throwing", async () => {
    const a = new CodexAdapter({
      codexHome: codexHomeCandidate,
      repoRoot: process.cwd(),
      llmPort: new FakeLLM("improve"),
    });
    const trajs = await a.readTrajectories("smoke-sha");
    expect(Array.isArray(trajs)).toBe(true);
  });

  it("AGENTS.md round-trip if repo has one", async () => {
    const agentsPath = join(process.cwd(), "AGENTS.md");
    if (!existsSync(agentsPath)) {
      return; // 无 AGENTS.md 不强测
    }
    const a = new CodexAdapter({
      codexHome: codexHomeCandidate,
      repoRoot: process.cwd(),
      llmPort: new FakeLLM("improve"),
    });
    const sub = await a.readSubstrate("codex/AGENTS.md");
    expect(sub.content.length).toBeGreaterThan(0);
  });
});

void execSync;
