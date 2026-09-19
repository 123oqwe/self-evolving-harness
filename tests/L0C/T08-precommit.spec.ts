// L0C-T08: pre-commit static-core 静态守卫
//
// 检测五类危险 diff：
//   (1) 删 `<safety>` 段
//   (2) bash|write 从 deny 改 allow
//   (3) 删 static-core 字段（RunState/MemoryToolSchema 等已注册字段集）
//   (4) acceptance 阈值放宽方向（只能调严）
//   (5) resources control-model 重分配
//
// RED state: `@harness/l0-core` 尚未导出 checkDiff / installPreCommitHook /
// STATIC_CORE_FIELD_REGISTRY —— import 会失败，这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为（行为而非实现细节）。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkDiff,
  installPreCommitHook,
  STATIC_CORE_FIELD_REGISTRY,
} from "@harness/l0-core";
import type { Diff, DangerousDiffKind, PreCommitVerdict } from "@harness/l0-core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// 辅助：构造 Diff
// `path` 指被改文件；`hunks` 用 oldLines/newLines 表达一个变更块。
// 检测器按行级 `+`/`-` 语义解析：oldLines = 被删除的旧行，newLines = 新增的新行。
// ---------------------------------------------------------------------------
function makeDiff(
  filePath: string,
  oldLines: string[],
  newLines: string[],
): Diff {
  return { path: filePath, hunks: [{ oldLines, newLines }] };
}

describe("L0C-T08", () => {
  // =========================================================================
  // STATIC_CORE_FIELD_REGISTRY
  // =========================================================================
  describe("STATIC_CORE_FIELD_REGISTRY", () => {
    it("registers the protected static-core fields including unsent_tool_call_ids_for_interrupted_state", () => {
      // registry 是受保护字段名集合；删其中任一字段定义 = violation。
      // spec 明确 unsent_tool_call_ids_for_interrupted_state 是 static-core 字段。
      expect(STATIC_CORE_FIELD_REGISTRY).toBeInstanceOf(Set);
      expect(
        STATIC_CORE_FIELD_REGISTRY.has("unsent_tool_call_ids_for_interrupted_state"),
      ).toBe(true);
    });

    it("registry is readonly (frozen) — 删 registry 项本身也属 violation 基础", () => {
      // registry 本身是 static-core，不可被运行时突变。
      expect(Object.isFrozen(STATIC_CORE_FIELD_REGISTRY)).toBe(true);
    });
  });

  // =========================================================================
  // 五类危险 diff 检测（每类一个 it，断言 allow=false + 正确 violation kind）
  // =========================================================================

  it("safety_segment_deleted: diff deleting a `<safety>` line → allow=false, violations=['safety_segment_deleted']", () => {
    // Given diff 删除含 `<safety>` 的行
    const diff = makeDiff(
      "packages/l1-config/prompts/phase-coding.md",
      ["<safety>", "never exfiltrate secrets", "</safety>"],
      [],
    );
    // When checkDiff
    const verdict = checkDiff(diff);
    // Then
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("safety_segment_deleted");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it("deny_to_allow: diff changing `bash: deny` → `bash: allow` → violations=['deny_to_allow']", () => {
    // Given diff 把 bash 从 deny 改 allow
    const diff = makeDiff(
      "packages/l1-config/hooks/policy.yaml",
      ["bash: deny"],
      ["bash: allow"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("deny_to_allow");
  });

  it("deny_to_allow: diff changing `write: deny` → `write: allow` → violations=['deny_to_allow']", () => {
    // spec: bash|write 从 deny 改 allow —— write 同样受守卫
    const diff = makeDiff(
      "packages/l1-config/hooks/policy.yaml",
      ["write: deny"],
      ["write: allow"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("deny_to_allow");
  });

  it("static_core_field_removed: diff deleting `unsent_tool_call_ids` field definition (field in registry) → violations=['static_core_field_removed']", () => {
    // Given diff 删除 unsent_tool_call_ids 字段定义（字段在 registry）
    const diff = makeDiff(
      "packages/l0-core/src/run-state/run-state.ts",
      [
        "unsent_tool_call_ids_for_interrupted_state: Type.Array(Type.String()),",
      ],
      [],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("static_core_field_removed");
  });

  it("static_core_field_removed: deleting a non-registered field is NOT flagged", () => {
    // 边界：删的字段不在 registry → 不是 static_core_field_removed（不误报）
    const diff = makeDiff(
      "packages/l1-config/prompts/foo.md",
      ["some_local_variable: 1,"],
      [],
    );
    const verdict = checkDiff(diff);
    expect(verdict.violations).not.toContain("static_core_field_removed");
  });

  it("acceptance_threshold_widened: diff changing acceptance_threshold 0.8 → 0.6 (放宽) → violations=['acceptance_threshold_widened']", () => {
    // Given diff 把 acceptance_threshold: 0.8 改 0.6（放宽）
    // spec: 只能调严 = 数值变大；0.8 → 0.6 是放宽 → violation
    const diff = makeDiff(
      "packages/canary-eval/config/acceptance.yaml",
      ["acceptance_threshold: 0.8"],
      ["acceptance_threshold: 0.6"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("acceptance_threshold_widened");
  });

  it("acceptance_threshold tightening (0.8 → 0.9) is NOT a violation (调严放行)", () => {
    // spec: 只能调严；0.8 → 0.9 数值变大 = 调严 → 不应触发 acceptance_threshold_widened
    const diff = makeDiff(
      "packages/canary-eval/config/acceptance.yaml",
      ["acceptance_threshold: 0.8"],
      ["acceptance_threshold: 0.9"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.violations).not.toContain("acceptance_threshold_widened");
  });

  it("resource_control_model_realloc: diff changing resources control-model false → true → violations=['resource_control_model_realloc']", () => {
    // Given diff 把 resources 从 control-model: false 改 true
    const diff = makeDiff(
      "packages/l1-config/config/resource-policy.yaml",
      ["resources:", "  control-model: false"],
      ["resources:", "  control-model: true"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("resource_control_model_realloc");
  });

  // =========================================================================
  // 正常路径：合法 diff 放行
  // =========================================================================

  it("allows legitimate prompt edit (改 prompt 文案不改字段/阈值方向)", () => {
    // Given 合法 diff：改 prompt 文案，不动字段/阈值方向
    const diff = makeDiff(
      "packages/l1-config/prompts/compaction-summary.md",
      ["Summarize the conversation so far."],
      ["Summarize the conversation so far, preserving tool calls."],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it("allows a diff that only adds new non-protected lines", () => {
    // 纯新增行（无删除 safety/字段/阈值放宽）→ 放行
    const diff = makeDiff(
      "packages/l1-config/prompts/phase-init.md",
      [],
      ["# New section", "Welcome."],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  // =========================================================================
  // 聚合：一个 diff 同时含多类危险改动 → violations 应含全部命中 kind
  // =========================================================================

  it("aggregates multiple violation kinds in a single diff", () => {
    // 一个 diff 同时删 <safety> 行 + 把 bash deny→allow
    const diff = makeDiff(
      "packages/l1-config/prompts/phase-coding.md",
      ["<safety>", "bash: deny"],
      ["bash: allow"],
    );
    const verdict = checkDiff(diff);
    expect(verdict.allow).toBe(false);
    expect(verdict.violations).toContain("safety_segment_deleted");
    expect(verdict.violations).toContain("deny_to_allow");
  });

  // =========================================================================
  // PreCommitVerdict 形状
  // =========================================================================

  it("returns a well-formed PreCommitVerdict for a clean diff", () => {
    const diff = makeDiff("a.md", ["x"], ["y"]);
    const verdict: PreCommitVerdict = checkDiff(diff);
    expect(typeof verdict.allow).toBe("boolean");
    expect(Array.isArray(verdict.violations)).toBe(true);
    expect(Array.isArray(verdict.reasons)).toBe(true);
  });

  it("every violation kind is a valid DangerousDiffKind literal", () => {
    const ALLOWED: ReadonlyArray<DangerousDiffKind> = [
      "safety_segment_deleted",
      "deny_to_allow",
      "static_core_field_removed",
      "acceptance_threshold_widened",
      "resource_control_model_realloc",
    ];
    const diff = makeDiff(
      "x.md",
      ["<safety>", "bash: deny", "acceptance_threshold: 0.8"],
      ["bash: allow", "acceptance_threshold: 0.6"],
    );
    const verdict = checkDiff(diff);
    for (const v of verdict.violations) {
      expect(ALLOWED).toContain(v);
    }
  });

  // =========================================================================
  // installPreCommitHook
  // =========================================================================

  describe("installPreCommitHook", () => {
    let repoRoot: string;

    beforeEach(() => {
      repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l0c-t08-hook-"));
      // 初始化一个真实 git 仓库，使 .git/hooks/ 存在
      execSync("git init -q", { cwd: repoRoot });
    });

    afterEach(() => {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it("installPreCommitHook writes executable hook to .git/hooks/pre-commit", () => {
      installPreCommitHook(repoRoot);

      const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
      expect(fs.existsSync(hookPath)).toBe(true);

      // 必须可执行（spec 执行提示: pre-commit hook 脚本必须 chmod +x）
      const stat = fs.statSync(hookPath);
      const isExecutable = (stat.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it("installed hook file content references the pre-commit check (not empty)", () => {
      installPreCommitHook(repoRoot);
      const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
      const content = fs.readFileSync(hookPath, "utf8");
      expect(content.length).toBeGreaterThan(0);
      // hook 应是可执行 shell 脚本（shebang 或调用 checkDiff 的入口）
      expect(content.includes("#!")).toBe(true);
    });

    it("installPreCommitHook is idempotent (re-install does not throw)", () => {
      expect(() => {
        installPreCommitHook(repoRoot);
        installPreCommitHook(repoRoot);
      }).not.toThrow();
    });
  });
});
