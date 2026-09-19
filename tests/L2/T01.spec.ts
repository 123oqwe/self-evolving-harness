// L2-T01: Agent Skills 标准加载器 [MVP]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T01）全部 Given/When/Then。
// RED state: 模块尚未实现，从 `@harness/l2-memory` 的 import 会失败——合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkill, loadAll } from "@harness/l2-memory";
import type { LoadedSkill, LoadError } from "@harness/l2-memory";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeSkillDir(
  root: string,
  name: string,
  fm: Record<string, unknown>,
  body = "body content",
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const fmText =
    "---\n" +
    Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n") +
    `\n---\n${body}`;
  writeFileSync(join(dir, "SKILL.md"), fmText);
  return dir;
}

describe("L2-T01", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l2-t01-"));
  });

  it("loadSkill loads compliant skill", () => {
    const dir = makeSkillDir(root, "pdf", {
      name: "pdf",
      description: "Convert documents to PDF",
    });
    const result = loadSkill(dir);
    const ok = result as LoadedSkill;
    expect(ok.frontmatter).toBeDefined();
    expect(ok.frontmatter.name).toBe("pdf");
    expect(ok.frontmatter.description).toBe("Convert documents to PDF");
    expect(typeof ok.body).toBe("string");
    expect(ok.body.length).toBeGreaterThan(0);
    expect(ok.level).toBe(1);
    expect(ok.dir).toBe(dir);
  });

  it("loadSkill rejects missing description", () => {
    const dir = makeSkillDir(root, "nodesc", { name: "nodesc" });
    const result = loadSkill(dir);
    const err = result as LoadError;
    expect(err.kind).toBe("missing-description");
    expect(err.dir).toBe(dir);
    // 边界：该 skill 不进入 loaded 列表
    const loaded = loadAll([dir]);
    expect(loaded.length).toBe(0);
  });

  it("loadAll first-wins on name collision and warns", () => {
    const dirA = makeSkillDir(root, "a", {
      name: "pdf",
      description: "from dirA",
    });
    const dirB = makeSkillDir(root, "b", {
      name: "pdf",
      description: "from dirB",
    });
    const loaded = loadAll([dirA, dirB]);
    expect(loaded.length).toBe(1);
    expect(loaded[0].dir).toBe(dirA);
    expect(loaded[0].frontmatter.description).toBe("from dirA");
  });

  it("loadSkill rejects invalid name uppercase", () => {
    const dir = makeSkillDir(root, "bad", {
      name: "PDF_Bad",
      description: "uppercase and underscore",
    });
    const result = loadSkill(dir);
    const err = result as LoadError;
    expect(err.kind).toBe("name-invalid");
  });

  it("loadSkill rejects name too long", () => {
    const longName = "a".repeat(65);
    const dir = makeSkillDir(root, "long", {
      name: longName,
      description: "too long",
    });
    const result = loadSkill(dir);
    const err = result as LoadError;
    expect(err.kind).toBe("name-invalid");
  });
});
