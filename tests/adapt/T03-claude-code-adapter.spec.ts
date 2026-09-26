// ADP-T03: Claude Code 适配器 — ClaudeCodeAdapter + exam-lock
//
// 覆盖 spec（execution/adapt/TASKS.md §ADP-T03）的 Given/When/Then 全部场景：
//   1. readSubstrate 读 CLAUDE.md 与 SKILL.md
//   2. writeSubstrate 落 staging，active 未被覆盖
//   3. readTrajectories 映射 Claude Code JSONL → L3 Trajectory
//   4. readTrajectories 跳过非 JSON 行
//   5. isExamLockedPath 命中 tests/**/*.spec.ts，不命中源码
//   6. buildExamLockHook 输出 PreToolUse deny 规则（Write/Edit/Bash on tests/）
//   7. llmPort 透传 opts.llmPort（adapter 不自己 spawn）
//   8. deploy 版本后缀 + git commit
//   9. rollback 还原到 rollbackTo sha
//  10. readSubstrate 未知 id → SubstrateNotFoundError
//
// RED state: @harness/adapters 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  ClaudeCodeAdapter,
  SubstrateNotFoundError,
  buildExamLockHook,
  isExamLockedPath,
} from "@harness/adapters";
import type { ClaudeCodeAdapterOptions, ExamLockRule } from "@harness/adapters";
import type { Trajectory } from "@harness/l3-engine";
import {
  FakeLLM,
  makeGitRepo,
  GitRepo,
  writeClaudeJsonl,
  makeFailedClaudeSession,
} from "./fixtures/helpers";

// ---------------------------------------------------------------------------
// exam-lock 纯函数单元
// ---------------------------------------------------------------------------

describe("ADP-T03 · exam-lock", () => {
  it("isExamLockedPath matches tests/**/*.spec.ts only", () => {
    // Given 测试文件路径与源码路径
    // When/Then
    expect(isExamLockedPath("tests/L3/T01-router.spec.ts")).toBe(true);
    expect(isExamLockedPath("tests/adapt/T02-pi-adapter.spec.ts")).toBe(true);
    expect(isExamLockedPath("tests/CE/CE-T02.spec.ts")).toBe(true);
    expect(isExamLockedPath("packages/l3-engine/src/types.ts")).toBe(false);
    expect(isExamLockedPath("packages/adapters/src/pi/pi-adapter.ts")).toBe(false);
    expect(isExamLockedPath("README.md")).toBe(false);
  });

  it("buildExamLockHook emits PreToolUse deny rules for Write/Edit/Bash on tests/", () => {
    // Given ExamLockRule 集合（覆盖 Write/Edit/Bash）
    const rules: ExamLockRule[] = [
      {
        event: "PreToolUse",
        matcher: { tool: "Write", pathPattern: "tests/**/*.spec.ts" },
        decision: "deny",
        reason: "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)",
      },
      {
        event: "PreToolUse",
        matcher: { tool: "Edit", pathPattern: "tests/**/*.spec.ts" },
        decision: "deny",
        reason: "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)",
      },
      {
        event: "PreToolUse",
        matcher: { tool: "Bash", pathPattern: "tests/**/*.spec.ts" },
        decision: "deny",
        reason: "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)",
      },
    ];
    // When buildExamLockHook
    const hookJson = buildExamLockHook(rules);
    // Then 输出合法 JSON + 含三类工具 deny 规则
    expect(() => JSON.parse(hookJson)).not.toThrow();
    const parsed = JSON.parse(hookJson);
    const serialized = JSON.stringify(parsed);
    expect(serialized).toContain("PreToolUse");
    expect(serialized).toContain("Write");
    expect(serialized).toContain("Edit");
    expect(serialized).toContain("Bash");
    expect(serialized).toContain("deny");
    expect(serialized).toContain("exam-lock");
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeAdapter 行为
// ---------------------------------------------------------------------------

describe("ADP-T03 · ClaudeCodeAdapter GWT", () => {
  let repo: GitRepo;
  let claudeHome: string;

  beforeEach(() => {
    repo = makeGitRepo();
    claudeHome = join(repo.root, ".claude-home");
    // repoRoot 含 CLAUDE.md + .claude/skills/evolve/SKILL.md
    repo.writeFile("CLAUDE.md", "# CLAUDE.md\nproject rules\n");
    repo.writeFile(
      ".claude/skills/evolve/SKILL.md",
      "---\nname: evolve\ndescription: evolve skill\n---\n# Evolve\nbody\n",
    );
    repo.commit("baseline claude-code substrate");
  });

  afterEach(() => {
    repo.destroy();
  });

  function makeAdapter(opts: Partial<ClaudeCodeAdapterOptions> = {}): ClaudeCodeAdapter {
    return new ClaudeCodeAdapter({
      claudeHome,
      repoRoot: repo.root,
      llmPort: new FakeLLM("CLAUDE-LLM-REPLY"),
      ...opts,
    });
  }

  it("readSubstrate reads CLAUDE.md and SKILL.md", async () => {
    const adapter = makeAdapter();
    const claude = await adapter.readSubstrate("claude-code/CLAUDE.md");
    expect(claude.content).toContain("project rules");
    expect(claude.sha).toBeTruthy();
    const skill = await adapter.readSubstrate(
      "claude-code/skills/evolve/SKILL.md",
    );
    expect(skill.content).toContain("Evolve");
  });

  it("writeSubstrate lands in staging, active untouched", async () => {
    const activeBefore = repo.read("CLAUDE.md");
    const adapter = makeAdapter();
    const staged = await adapter.writeSubstrate(
      "claude-code/CLAUDE.md",
      "# CLAUDE.md\nMUTATED rules\n",
    );
    // active 未被覆盖
    expect(repo.read("CLAUDE.md")).toBe(activeBefore);
    expect(staged.sha).toBeTruthy();
  });

  it("readTrajectories maps Claude Code JSONL to L3 Trajectory", async () => {
    // Given ~/.claude/projects/<encoded-cwd>/<sid>.jsonl 含 Claude Code 事件流
    const sid = "sess-claude-1";
    const projDir = join(claudeHome, "projects", "encoded-repo");
    writeClaudeJsonl(projDir, sid, makeFailedClaudeSession(sid));
    const adapter = makeAdapter({
      trajectoryBaseDir: projDir,
    } as Partial<ClaudeCodeAdapterOptions>);
    // When readTrajectories
    const trajs: Trajectory[] = await adapter.readTrajectories("any-sha");
    // Then 映射为 Trajectory[]，sessionId 匹配 + failed=true + diagnosis 非空
    expect(trajs.length).toBeGreaterThanOrEqual(1);
    expect(trajs[0]!.sessionId).toBe(sid);
    expect(trajs[0]!.failed).toBe(true);
    expect(trajs[0]!.diagnosis.length).toBeGreaterThan(0);
  });

  it("readTrajectories skips non-JSON lines", async () => {
    const sid = "sess-mixed-claude";
    const projDir = join(claudeHome, "projects", "encoded-repo");
    mkdirSync(projDir, { recursive: true });
    const good = makeFailedClaudeSession(sid);
    writeFileSync(
      join(projDir, `${sid}.jsonl`),
      good.map((e) => JSON.stringify(e)).join("\n") +
        "\nNOT JSON\n{broken\n",
      "utf8",
    );
    const adapter = makeAdapter({
      trajectoryBaseDir: projDir,
    } as Partial<ClaudeCodeAdapterOptions>);
    // When/Then 不崩，返回合法轨迹
    const trajs = await adapter.readTrajectories("any-sha");
    expect(trajs.length).toBeGreaterThanOrEqual(1);
  });

  it("llmPort is passthrough from opts", async () => {
    const fake = new FakeLLM("PASSTHROUGH-REPLY");
    const adapter = makeAdapter({ llmPort: fake });
    // When adapter.llmPort.complete
    const out = await adapter.llmPort.complete("anything");
    // Then 透传到注入的 FakeLLM
    expect(out).toBe("PASSTHROUGH-REPLY");
    expect(fake.calls).toContain("anything");
  });

  it("deploy bumps version + git commits", async () => {
    const adapter = makeAdapter();
    const staged = await adapter.writeSubstrate(
      "claude-code/CLAUDE.md",
      "# CLAUDE.md\nDEPLOYED\n",
    );
    const headBefore = repo.head();
    const result = await adapter.deploy(staged.sha);
    expect(repo.head()).not.toBe(headBefore);
    expect(result.version).toBeTruthy();
    expect(result.rollbackTo).toBe(headBefore);
    expect(repo.read("CLAUDE.md")).toContain("DEPLOYED");
  });

  it("rollback restores to rollbackTo sha", async () => {
    const adapter = makeAdapter();
    const original = repo.read("CLAUDE.md");
    const staged = await adapter.writeSubstrate(
      "claude-code/CLAUDE.md",
      "# MUTATED\nrollback\n",
    );
    const result = await adapter.deploy(staged.sha);
    await adapter.rollback(result.rollbackTo);
    expect(repo.read("CLAUDE.md")).toBe(original);
  });

  it("readSubstrate unknown id throws SubstrateNotFoundError", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.readSubstrate("claude-code/no-such.md"),
    ).rejects.toBeInstanceOf(SubstrateNotFoundError);
  });
});
