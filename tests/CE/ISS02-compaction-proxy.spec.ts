// ISS-02 步骤①②: 基质敏感代理任务(结构检查) + 部署后打分(注入骨架)单测。
//
// ② 结构代理任务: checkCompactionPromptStructure / buildCompactionProxyTasks。
// ① 部署后打分: injectSubstratePath / deploySubstrateToWorkspace / scoreSubstrateTask。
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkCompactionPromptStructure,
  buildCompactionProxyTasks,
  COMPACTION_SUBSTRATE_PATH,
  injectSubstratePath,
  deploySubstrateToWorkspace,
  scoreSubstrateTask,
  SUBSTRATE_ENV,
  type CanaryTask,
  type VerifierRun,
  type SandboxHandle,
} from "@harness/canary-eval";

// ── fixture ─────────────────────────────────────────────────────────────────

const BASELINE = [
  "## Goal",
  "Summarize progress.",
  "## Constraints",
  "- (none)",
  "## Progress",
  "### Done",
  "- [x] a",
  "### In Progress",
  "- [ ] b",
  "### Blocked",
  "- Issue X blocks progress",
  "## Decisions",
  "- **D**: rationale",
  "## Next Steps",
  "1. next",
  "## Critical Context",
  "- ref",
  "<read-files>",
  "- a.txt",
  "</read-files>",
  "<modified-files>",
  "- b.txt",
  "</modified-files>",
  "<safety>",
  "Never omit unresolved bugs from the Progress section. Never drop tool_use_id pairing.",
  "</safety>",
  "Preserve exact file paths, function names, and error messages.",
].join("\n");

// ── ② 结构代理任务 ──────────────────────────────────────────────────────────

describe("ISS-02 · ② checkCompactionPromptStructure", () => {
  it("完整 baseline 结构全部通过", () => {
    const v = checkCompactionPromptStructure(BASELINE);
    expect(v.ok).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it("缺必需段落 → 判 fail", () => {
    const broken = BASELINE.replace("## Critical Context\n", "");
    const v = checkCompactionPromptStructure(broken, ["required-sections"]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toMatch(/Critical Context/);
  });

  it("Blocked 段被合并(缺失) → 判 fail", () => {
    const broken = BASELINE.replace("### Blocked\n- Issue X blocks progress\n", "");
    const v = checkCompactionPromptStructure(broken, ["blocked-not-merged"]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toMatch(/Blocked/);
  });

  it("tool_use_id 保留指令缺失 → 判 fail", () => {
    const broken = BASELINE.replace("Never drop tool_use_id pairing.", "");
    const v = checkCompactionPromptStructure(broken, ["tool-use-id-preserved"]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toMatch(/tool_use_id/);
  });

  it("错误原文保留指令缺失 → 判 fail", () => {
    const broken = BASELINE.replace(
      "Preserve exact file paths, function names, and error messages.",
      "",
    );
    const v = checkCompactionPromptStructure(broken, ["error-text-preserved"]);
    expect(v.ok).toBe(false);
  });

  it("safety 段不完整 → 判 fail", () => {
    const broken = BASELINE.replace("</safety>", "");
    const v = checkCompactionPromptStructure(broken, ["safety-complete"]);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toMatch(/safety/i);
  });

  it("buildCompactionProxyTasks 产出 5 条 proxy 任务，标 proxy+substrate", () => {
    const tasks = buildCompactionProxyTasks();
    expect(tasks.length).toBe(5);
    for (const t of tasks) {
      expect(t.proxy).toBe(true);
      expect(t.substrate).toBe(COMPACTION_SUBSTRATE_PATH);
      expect(t.verify).toMatch(/check-compaction-proxy\.mjs --check /);
      expect(t.expectedExit).toBe(0);
      expect(t.decontaminated).toBe(true);
    }
    expect(tasks.map((t) => t.id).join(",")).toBe(
      "CE-PROXY-0001,CE-PROXY-0002,CE-PROXY-0003,CE-PROXY-0004,CE-PROXY-0005",
    );
  });
});

// ── ① 部署后打分(注入骨架) ──────────────────────────────────────────────────

describe("ISS-02 · ① substrate scoring skeleton", () => {
  it("injectSubstratePath 前缀注入 HARNESS_SUBSTRATE_PATH", () => {
    const cmd = injectSubstratePath("node scripts/check-compaction-proxy.mjs", "/tmp/sub/prompt.md");
    expect(cmd).toBe(`${SUBSTRATE_ENV}="/tmp/sub/prompt.md" node scripts/check-compaction-proxy.mjs`);
  });

  it("deploySubstrateToWorkspace 写入内容并返回绝对路径", () => {
    const dir = mkdtempSync(join(tmpdir(), "iss02-deploy-"));
    try {
      const abs = deploySubstrateToWorkspace(BASELINE, dir, "prompts/compaction-summary.md");
      expect(readFileSync(abs, "utf8")).toBe(BASELINE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scoreSubstrateTask 注入基质路径后 runVerify", async () => {
    const captured: string[] = [];
    const sandbox: SandboxHandle = {
      async runVerify(cmd) {
        captured.push(cmd);
        return { exitCode: 0, stdout: "ok", stderr: "", epermHits: [] };
      },
    };
    const task: CanaryTask = {
      id: "CE-PROXY-0001",
      repo: "harness/l1-compaction-proxy",
      verify: "node scripts/check-compaction-proxy.mjs --check required-sections",
      expectedExit: 0,
      decontaminated: true,
      frozenInRelease: "a".repeat(40),
      proxy: true,
      substrate: COMPACTION_SUBSTRATE_PATH,
    };
    const run: VerifierRun = await scoreSubstrateTask(task, "/tmp/sub/prompt.md", sandbox);
    expect(captured[0]).toContain(`${SUBSTRATE_ENV}="/tmp/sub/prompt.md"`);
    expect(captured[0]).toContain("--check required-sections");
    expect(run.exitCode).toBe(0);
    // 审计面: VerifierRun.command 记录注入后的命令。
    expect(run.command).toContain(SUBSTRATE_ENV);
  });
});
