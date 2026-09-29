#!/usr/bin/env node
// exam-lock-hook.mjs — Claude Code PreToolUse hook (ISS-09).
//
// 真实 Claude Code hook 形状：Claude Code 把 PreToolUse 事件 JSON 经 stdin 传给
// 本脚本，脚本输出 `hookSpecificOutput.permissionDecision` 决定 allow/deny。
// 声明式 schema（`decision`/`pathPattern`）在真实 Claude Code 中不存在
// （见 ISS-09）。
//
// 锁定语义：tests/ 下任意深度 .spec.ts（TEST-LOCK §1 出题权分离），与
// exam-lock.ts 的 `isExamLockedPath` 同构。本脚本是独立 .mjs（被 Claude Code
// 用纯 `node` 执行，无 TS loader），故逻辑内联不导入 .ts。
//
// 定位（ISS-10 详述）：hook 是减速带而非安全边界；真正的边界落在 l0-sandbox
// 的 fs profile（tests/ 只读挂载）+ CI 测试锁（TEST-LOCK §1.2 sha256 门）。
// Bash 处理为最小保守版（命令文本出现 tests/ 且含写语义即 deny），ISS-10 会
// 扩到 ≥10 种写法表。

import { readFileSync } from "node:fs";

const EXAM_LOCK_REASON =
  "exam-lock: tests/ are test-author-locked (TEST-LOCK §1)";

/**
 * 命中 tests/ 下任意深度 .spec.ts（与 exam-lock.ts isExamLockedPath 同构）。
 */
function isExamLockedPath(p) {
  const norm = String(p).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm.startsWith("tests/")) return false;
  if (!norm.endsWith(".spec.ts")) return false;
  const middle = norm.slice("tests/".length, -".spec.ts".length);
  if (middle.length === 0) return false;
  if (middle.split("/").includes("..")) return false;
  return true;
}

/** Bash 写语义 token（最小保守集，ISS-10 会扩到 ≥10 种并加边界文档）。 */
const BASH_WRITE_TOKENS = [
  ">",
  ">>",
  "sed -i",
  "tee",
  "cp",
  "mv",
  "rm",
  "git checkout",
  "git restore",
  "patch",
  "rsync",
  "dd",
  "install",
  "unlink",
];

/**
 * Bash 命令写测试文件兜底判定：命令文本出现 tests/ 且含写语义 token 即 deny。
 * 仅作减速带；变量拼接/`cd tests &&`/heredoc 等可绕过——真边界在 l0-sandbox。
 */
function bashWritesLockedTest(command) {
  const cmd = String(command ?? "");
  if (!cmd.includes("tests/")) return false;
  return BASH_WRITE_TOKENS.some((t) => cmd.includes(t));
}

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // 无 stdin（手动调试等）→ allow（不阻断）。
    process.exit(0);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // stdin 非 JSON → 放行（Claude Code 不应被坏输入阻断）。
    process.exit(0);
  }
  const toolName = String(payload?.tool_name ?? "");
  const toolInput = (payload?.tool_input ?? {}) ;
  let deny = false;
  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "MultiEdit" ||
    toolName === "NotebookEdit"
  ) {
    const filePath =
      String(toolInput?.file_path ?? toolInput?.notebook_path ?? "");
    deny = isExamLockedPath(filePath);
  } else if (toolName === "Bash") {
    deny = bashWritesLockedTest(toolInput?.command ?? "");
  }
  if (deny) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: EXAM_LOCK_REASON,
        },
      }) + "\n",
    );
    process.exit(0);
  }
  // allow：无输出 + exit 0（Claude Code 视为放行）。
  process.exit(0);
}

main();
