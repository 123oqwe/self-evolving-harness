// L2-T15: 包管理信任门 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T15）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  trustGate,
  stripSecrets,
  neverAutoInstallProject,
  breakerScan,
} from "@harness/l2-memory";
import type { PkgRef, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

describe("L2-T15", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t15-"));
  });

  it("trustGate rejects project skill without trust", () => {
    const ref: PkgRef = {
      source: "git",
      specifier: "git+https://example/skill.git",
      trustDeclared: false,
      installs: 500,
    };
    const res = trustGate(ref, true, ctx(baseDir));
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toMatch(/explicit trust|trust/i);
  });

  it("trustGate accepts project skill with trust", () => {
    const ref: PkgRef = {
      source: "git",
      specifier: "git+https://example/skill.git",
      trustDeclared: true,
      installs: 500,
    };
    const res = trustGate(ref, true, ctx(baseDir));
    expect(res.ok).toBe(true);
  });

  it("trustGate warns on <100 installs", () => {
    const ref: PkgRef = {
      source: "git",
      specifier: "git+https://example/skill.git",
      trustDeclared: true,
      installs: 50,
    };
    const c = ctx(baseDir) as unknown as MemCtx & { warnings?: string[] };
    (c as Record<string, unknown>).warnings = [];
    const res = trustGate(ref, true, c);
    // allow 但 warn <100 installs
    expect(res.ok).toBe(true);
    expect((c as unknown as { warnings: string[] }).warnings.some((w) => /100 installs/i.test(w))).toBe(true);
  });

  it("stripSecrets removes TOKEN env", () => {
    const out = stripSecrets({ OPENAI_API_KEY: "sk-xxx", TOKEN: "abc", PATH: "/usr/bin" });
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.TOKEN).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
  });

  it("stripSecrets removes SECRET/KEY/AUTH", () => {
    const out = stripSecrets({
      MY_SECRET: "s",
      API_KEY: "k",
      AUTH_HEADER: "a",
      NORMAL_VAR: "v",
    });
    expect(out.MY_SECRET).toBeUndefined();
    expect(out.API_KEY).toBeUndefined();
    expect(out.AUTH_HEADER).toBeUndefined();
    expect(out.NORMAL_VAR).toBe("v");
  });

  it("stripSecrets preserves non-secret env", () => {
    const out = stripSecrets({ HOME: "/home/u", LANG: "en_US" });
    expect(out.HOME).toBe("/home/u");
    expect(out.LANG).toBe("en_US");
  });

  it("never-auto-install-project enforced", () => {
    // 任何自动安装 project skill 的调用 → reject
    const ref: PkgRef = {
      source: "git",
      specifier: "git+https://example/skill.git",
      trustDeclared: false,
    };
    const res = neverAutoInstallProject(ref, ctx(baseDir));
    expect(res.ok).toBe(false);
  });

  it("breakerScan flags eval/exec/network", () => {
    expect(breakerScan("eval('1')")).toContain("eval");
    expect(
      breakerScan("require('child_process').exec('x')"),
    ).toContain("exec");
    expect(
      breakerScan("require('https').get('u')"),
    ).toContain("network");
  });
});
