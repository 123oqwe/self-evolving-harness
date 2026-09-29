// ADP-T03: Claude Code 考卷锁定 = PreToolUse hook 拒改测试文件。
//
// Spec: execution/adapt/TASKS.md §ADP-T03 (exam-lock.ts).
// 复用铁律（§0.2）：TEST-LOCK §1 出题权分离规则——`isExamLockedPath` 命中
// `tests/**/*.spec.ts` 对齐 TEST-LOCK 锁定范围（与 L0C-T11 static-core 互补：
// static-core 守源码，exam-lock 守考卷）。无新依赖，手写 glob 匹配。
//
// ISS-09: 旧实现输出声明式 schema（matcher.decision/pathPattern），在真实
// Claude Code 中不存在。现改为真实 schema：matcher 字符串 + hooks:[{type:
// "command", command: node <abs>/exam-lock-hook.mjs}]，由 hook 脚本读 stdin
// 后返回 permissionDecision。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** 考卷锁定 hook 规则：matcher 命中 `tests/` 下任意深度 `.spec.ts` → decision 'deny'。 */
export interface ExamLockRule {
  readonly event: "PreToolUse";
  readonly matcher: {
    readonly tool: "Write" | "Edit" | "MultiEdit" | "NotebookEdit" | "Bash";
    readonly pathPattern: string;
  };
  readonly decision: "deny";
  /** "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)" */
  readonly reason: string;
}

/** 默认考卷锁定 glob：tests/ 下任意深度的 .spec.ts。 */
export const EXAM_LOCK_PATH_PATTERN = "tests/**/*.spec.ts";

/** 默认 exam-lock reason（TEST-LOCK §1 出题权分离）。 */
export const EXAM_LOCK_REASON =
  "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)";

/**
 * 命中 `tests/` 下任意深度 `.spec.ts` 判定（手写 glob，无新依赖）。
 *
 *  - 路径以 `tests/` 开头（容忍前导 `./` 与反斜杠）
 *  - 以 `.spec.ts` 结尾
 *  - 中间任意层级（含零层，即 `tests/foo.spec.ts` 也命中——`**` 匹配零或多层目录）
 *
 * 源码路径（packages/...、README.md 等）不命中。
 */
export function isExamLockedPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm.startsWith("tests/")) return false;
  if (!norm.endsWith(".spec.ts")) return false;
  // `tests/**/*.spec.ts`：tests/ 与 .spec.ts 之间须为合法路径段
  // （不含 `..` 越界）。`**` 匹配任意层数子目录（含零层）。
  const middle = norm.slice("tests/".length, -".spec.ts".length);
  if (middle.length === 0) return false; // 即 "tests/.spec.ts"——非法，不命中
  // 禁止 `..` 段（防 tests/../packages/x.spec.ts 逃逸）
  if (middle.split("/").includes("..")) return false;
  return true;
}

/**
 * 构造默认 ExamLockRule 集合（覆盖全部写文件工具 + Bash）。
 *
 * Bash 工具须覆盖 `sed -i`/`printf >` 等通过 shell 改测试文件的路径；
 * matcher 的 pathPattern 命中 `tests/` 下任意深度 `.spec.ts`。
 */
export function defaultExamLockRules(): ExamLockRule[] {
  const tools: Array<ExamLockRule["matcher"]["tool"]> = [
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "Bash",
  ];
  return tools.map((tool) => ({
    event: "PreToolUse",
    matcher: { tool, pathPattern: EXAM_LOCK_PATH_PATTERN },
    decision: "deny",
    reason: EXAM_LOCK_REASON,
  }));
}

/**
 * 输出真实 Claude Code PreToolUse hook 配置（ISS-09 修正）。
 *
 * 真实 schema：
 *   {"hooks":{"PreToolUse":[{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash",
 *     "hooks":[{"type":"command","command":"node <abs>/exam-lock-hook.mjs"}]}]}}
 * 声明式的 decision/pathPattern 在真实 Claude Code 中不存在；由 hook 脚本读
 * stdin JSON 后返回 hookSpecificOutput.permissionDecision。
 */
export function buildExamLockHook(rules: ExamLockRule[]): string {
  const tools = [...new Set(rules.map((r) => r.matcher.tool))];
  const matcher = tools.join("|");
  const hookDir = dirname(fileURLToPath(import.meta.url));
  const hookPath = join(hookDir, "exam-lock-hook.mjs");
  const config = {
    hooks: {
      PreToolUse: [
        {
          matcher,
          hooks: [{ type: "command", command: `node ${hookPath}` }],
        },
      ],
    },
  };
  return JSON.stringify(config, null, 2);
}
