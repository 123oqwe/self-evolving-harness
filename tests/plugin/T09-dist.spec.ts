// PLG-T09: 分发打包（npm publishable + agentskills.io skill bundles）。
//
// Spec: execution/plugin/TASKS.md §PLG-T09。
// RED 态：`packages/evolve-dist/` 未落地（scripts/skill-bundles/ 均不存在）+
// evolve-* 包 package.json 未追加 version/publishConfig/files/exports →
// 存在性/内容要素检查全失败 = 合法 RED（bash 断言形态，见 §0.5）。

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";

const REPO = process.cwd();
const DIST = join(REPO, "packages", "evolve-dist");

function listEvolvePackages(): string[] {
  try {
    return readdirSync(join(REPO, "packages"))
      .filter((d) => d.startsWith("evolve-"))
      .map((d) => join(REPO, "packages", d));
  } catch {
    return [];
  }
}

describe("PLG-T09 distribution", () => {
  it("publish.mjs --dry-run exits 0 for all evolve-* packages", () => {
    const script = join(DIST, "scripts", "publish.mjs");
    expect(existsSync(script)).toBe(true);
    // dry-run 须对每包 exit 0（无 missing files/main 错误）
    const out = execSync(`node ${JSON.stringify(script)} --dry-run`, {
      cwd: REPO,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    expect(out).not.toMatch(/error|missing/i);
  });

  it("all evolve-* package.json contain version/publishConfig/files/exports", () => {
    const pkgs = listEvolvePackages();
    expect(pkgs.length).toBeGreaterThan(0);
    for (const pkgDir of pkgs) {
      const pj = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      expect(pj.version, `${pkgDir} version`).not.toBe("0.0.0");
      expect(pj.version, `${pkgDir} version`).toMatch(/^\d+\.\d+\.\d+/);
      expect(pj.publishConfig, `${pkgDir} publishConfig`).toBeDefined();
      expect(pj.files, `${pkgDir} files`).toBeDefined();
      expect(pj.exports, `${pkgDir} exports`).toBeDefined();
    }
  });

  it("build-skill-bundles.mjs generates claude-code + hermes SKILL.md", () => {
    const script = join(DIST, "scripts", "build-skill-bundles.mjs");
    expect(existsSync(script)).toBe(true);
    execSync(`node ${JSON.stringify(script)}`, { cwd: REPO, stdio: "ignore" });
    const claudeSkill = join(DIST, "skill-bundles", "claude-code", "evolve", "SKILL.md");
    const hermesSkill = join(DIST, "skill-bundles", "hermes", "evolve", "SKILL.md");
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(hermesSkill)).toBe(true);
  });

  it("generated SKILL.md has valid frontmatter (name + description)", () => {
    const claudeSkill = join(DIST, "skill-bundles", "claude-code", "evolve", "SKILL.md");
    expect(existsSync(claudeSkill)).toBe(true);
    const text = readFileSync(claudeSkill, "utf8");
    expect(text).toMatch(/^---/);
    expect(text).toMatch(/name:\s*evolve/);
    expect(text).toMatch(/description:/);
  });

  it("generated SKILL.md body references evolve run command", () => {
    const hermesSkill = join(DIST, "skill-bundles", "hermes", "evolve", "SKILL.md");
    expect(existsSync(hermesSkill)).toBe(true);
    const text = readFileSync(hermesSkill, "utf8");
    expect(text).toMatch(/evolve run/);
  });
});

void globSync;
