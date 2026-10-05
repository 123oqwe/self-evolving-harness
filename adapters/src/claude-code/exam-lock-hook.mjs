#!/usr/bin/env node
// exam-lock-hook.mjs — Claude Code PreToolUse hook (ISS-09 schema + ISS-10 bash).
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
// 的 fs profile（static-core 只读挂载，ISS-18）+ CI 测试锁（TEST-LOCK §1.2
// sha256 门）。Bash 处理覆盖 ≥10 种绕过写法——变量拼接路径、`cd tests &&`、
// heredoc 重定向、`find -exec`/`find -delete`、`git checkout`/`git restore`、
// `rm -rf`、`cp`/`mv`/`rsync`/`dd`/`tee`/`sed -i` 等。判定 = 命令文本命中
// `tests`（路径或 `cd tests` 目录操作数）或 `.spec.ts` 目标 **且** 含写语义
// token 即 deny（减速带，默认从严，可误拦写 `tests/` 的无害重定向——安全侧）。
//
// 导出纯函数供 vitest 单测；import 不触发 stdin 读取 / process.exit。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/**
 * Bash 写语义 token 集（ISS-10 扩到覆盖绕过写法）。`>`/`>>` 覆盖重定向
 * （含 heredoc `cat > f <<'EOF'`）；`-exec`/`-delete` 覆盖 `find` 写路径；
 * `sed -i`/`perl -i` 覆盖原地编辑；其余为常规写/删/移文件命令。
 */
const BASH_WRITE_TOKENS = [
  ">",
  ">>",
  "sed -i",
  "perl -i",
  "tee",
  "cp",
  "mv",
  "rm",
  "dd",
  "install",
  "unlink",
  "truncate",
  "chmod",
  "chown",
  "touch",
  "git checkout",
  "git restore",
  "patch",
  "rsync",
  "-exec",
  "-delete",
];

/**
 * 命令文本是否引用了 tests 目录或 .spec.ts 目标。三种形态：
 *   1) 字面 `tests/` 路径（原最小保守版）；
 *   2) 任意 `.spec.ts` 文件目标（变量拼接路径 `p=te;p+=sts;p+=/;echo>"$p/x.spec.ts"`
 *      不产字面 `tests/`，但点名 .spec.ts）；
 *   3) 裸 `tests` 目录操作数（`cd tests` / `find tests` / `rm -rf tests` /
 *      `cp x tests` / `git checkout -- tests`，无尾斜杠）。词边界 `\btests\b`
 *      防 `testscript`/`testsetup` 前缀碰撞；可误拦含 "tests" 的普通文本，
 *      减速带默认从严（安全侧）。
 */
function mentionsTestsTarget(command) {
  const cmd = String(command ?? "");
  if (cmd.includes("tests/")) return true;
  if (/\.spec\.ts\b/.test(cmd)) return true;
  if (/\btests\b/.test(cmd)) return true;
  return false;
}

/**
 * Bash 命令写测试文件兜底判定：命令文本命中 tests/.spec.ts 目标 且含写语义
 * token 即 deny。仅作减速带；真边界在 l0-sandbox（ISS-18）。
 */
function bashWritesLockedTest(command) {
  const cmd = String(command ?? "");
  if (!mentionsTestsTarget(cmd)) return false;
  return BASH_WRITE_TOKENS.some((t) => cmd.includes(t));
}

/**
 * 纯判定：把 PreToolUse payload 归约为 { deny, reason }。供单测直调。
 * Write/Edit/MultiEdit/NotebookEdit 按 file_path；Bash 按 command。
 */
function decide(payload) {
  const toolName = String(payload?.tool_name ?? "");
  const toolInput = payload?.tool_input ?? {};
  let deny = false;
  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "MultiEdit" ||
    toolName === "NotebookEdit"
  ) {
    const filePath = String(
      toolInput?.file_path ?? toolInput?.notebook_path ?? "",
    );
    deny = isExamLockedPath(filePath);
  } else if (toolName === "Bash") {
    deny = bashWritesLockedTest(toolInput?.command ?? "");
  }
  return { deny, reason: deny ? EXAM_LOCK_REASON : null };
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
  const { deny, reason } = decide(payload);
  if (deny) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      }) + "\n",
    );
    process.exit(0);
  }
  // allow：无输出 + exit 0（Claude Code 视为放行）。
  process.exit(0);
}

export {
  EXAM_LOCK_REASON,
  BASH_WRITE_TOKENS,
  isExamLockedPath,
  mentionsTestsTarget,
  bashWritesLockedTest,
  decide,
};

// 仅在被 `node exam-lock-hook.mjs` 直接执行时读 stdin；被 import（单测）时
// 只暴露纯函数，绝不触碰 stdin / process.exit。
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
