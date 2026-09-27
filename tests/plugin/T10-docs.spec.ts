// PLG-T10: docs/adapters.md — 9 harness 接入矩阵文档。
//
// Spec: execution/plugin/TASKS.md §PLG-T10。
// RED 态：docs/adapters.md 未撰写 → 存在性/内容要素检查全失败 = 合法 RED（bash 断言形态）。

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = join(process.cwd(), "docs", "adapters.md");
const HARNESS_IDS = [
  "pi",
  "claude",
  "codex",
  "opencode",
  "hermes",
  "openclaw",
  "cursor",
  "generic",
  "grok", // GrokBuild 占位（verified:false）
];

function docText(): string {
  if (!existsSync(DOC)) return "";
  return readFileSync(DOC, "utf8");
}

describe("PLG-T10 docs/adapters.md", () => {
  it("docs/adapters.md exists", () => {
    expect(existsSync(DOC)).toBe(true);
  });

  it("contains 9-row matrix table (all harness ids present)", () => {
    const text = docText();
    for (const id of HARNESS_IDS) {
      expect(text, `matrix should mention harness id: ${id}`).toMatch(new RegExp(`\\b${id}\\b`, "i"));
    }
  });

  it("each row has install command (evolve init --harness or pnpm add @harness/)", () => {
    const text = docText();
    const evolveInitCount = (text.match(/evolve init --harness/g) || []).length;
    const pnpmAddCount = (text.match(/pnpm add @harness\//g) || []).length;
    expect(evolveInitCount + pnpmAddCount).toBeGreaterThanOrEqual(7);
  });

  it("marks unverified harnesses (GrokBuild verified:false)", () => {
    const text = docText();
    expect(text).toMatch(/verified:false/i);
  });

  it("references ADP-T02/T03 for pi/claude-code (not rewritten)", () => {
    const text = docText();
    expect(text).toMatch(/ADP-T02/);
    expect(text).toMatch(/ADP-T03/);
    // pi/claude 行须引用 @harness/adapters（非新建 evolve-pi/evolve-claude 包）
    expect(text).toMatch(/@harness\/adapters/);
  });

  it("documents agentskills.io skill bundle variants", () => {
    const text = docText();
    expect(text).toMatch(/agentskills|skill bundle|SKILL\.md/i);
  });
});
