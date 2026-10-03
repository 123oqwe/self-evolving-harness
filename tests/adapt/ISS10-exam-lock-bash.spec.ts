// ISS-10: exam-lock Bash 写语义拦截 — ≥10 种绕过写法全 deny（减速带）。
//
// 背景（VERDICT ISS-10）：hook 是减速带而非安全边界；真边界 = l0-sandbox
// fs profile（ISS-18 只读挂载）+ TEST-LOCK §1.2 sha256 门。本文件锁定
// `exam-lock-hook.mjs` 的 `bashWritesLockedTest`：命令文本命中 tests/.spec.ts
// 目标 且含写语义 token 即 deny。
//
// 绕过写法表（≥10，逐一断言 deny）：变量拼接路径（不产字面 tests/）、
// `cd tests &&`（无尾斜杠）、`git checkout`/`git restore`、heredoc 重定向、
// `find -exec` / `find -delete`、`rm -rf`、`cp`/`mv`/`rsync`/`dd`/`tee`/`sed -i`。
// 负例：只读命令（vitest/grep/diff/cat/ls）虽含 tests/ 但无写语义 → allow。
//
// 从 .mjs 直 import（hook 是独立脚本，export 纯函数供单测，import 不触发
// stdin/process.exit）。

import { describe, it, expect } from "vitest";
import {
  bashWritesLockedTest,
  decide,
  isExamLockedPath,
  EXAM_LOCK_REASON,
} from "../../adapters/src/claude-code/exam-lock-hook.mjs";

// ≥10 种绕过写法的命令文本，全部应 deny。
const DENY_CASES: string[] = [
  // 1. cd tests && 重定向（无尾斜杠 tests/，旧版 `includes("tests/")` 漏）
  "cd tests && echo bad > T01.spec.ts",
  // 2. cd tests && 原地编辑
  "cd tests && sed -i 's/a/b/' T01.spec.ts",
  // 3. 字面 tests/ 重定向（基础写法）
  "echo bad > tests/foo.spec.ts",
  // 4. 变量拼接路径（不产字面 tests/，但点名 .spec.ts 目标）
  'p=te; p+=sts; p+=/; echo bad > "$p/foo.spec.ts"',
  // 5. git checkout -- tests/
  "git checkout -- tests/foo.spec.ts",
  // 6. git restore tests/
  "git restore tests/foo.spec.ts",
  // 7. heredoc 重定向（cat > f <<'EOF'）
  "cat <<'EOF' > tests/foo.spec.ts\nx\nEOF",
  // 8. heredoc 重定向（tee f <<'EOF'）
  "tee tests/foo.spec.ts <<'EOF'\nx\nEOF",
  // 9. find -exec rm
  "find tests -name '*.spec.ts' -exec rm {} \\;",
  // 10. find -delete
  "find tests -name '*.spec.ts' -delete",
  // 11. rm -rf tests/
  "rm -rf tests/",
  // 12. cp 覆盖测试文件
  "cp evil.ts tests/foo.spec.ts",
  // 13. mv 改名测试文件
  "mv tests/foo.spec.ts tests/bar.spec.ts",
  // 14. rsync 覆盖
  "rsync -a src/ tests/",
  // 15. dd 写测试文件
  "dd if=evil of=tests/foo.spec.ts",
];

// 只读命令虽含 tests/ 但无写语义 → 应 allow。
const ALLOW_CASES: string[] = [
  "pnpm vitest run tests/L0C/T11-readonly.spec.ts",
  "grep -R foo tests/",
  "git diff tests/",
  "cat tests/foo.spec.ts",
  "ls tests/",
  "git status",
];

describe("ISS-10 · exam-lock Bash 写语义拦截", () => {
  it("denies ≥10 bypass write patterns", () => {
    expect(DENY_CASES.length).toBeGreaterThanOrEqual(10);
    for (const cmd of DENY_CASES) {
      expect(bashWritesLockedTest(cmd), `should deny: ${cmd}`).toBe(true);
    }
  });

  it("allows read-only commands mentioning tests/", () => {
    for (const cmd of ALLOW_CASES) {
      expect(bashWritesLockedTest(cmd), `should allow: ${cmd}`).toBe(false);
    }
  });

  it("decide() wires Bash deny through the hook payload", () => {
    const out = decide({
      tool_name: "Bash",
      tool_input: { command: "cd tests && echo bad > T01.spec.ts" },
    });
    expect(out.deny).toBe(true);
    expect(out.reason).toBe(EXAM_LOCK_REASON);
  });

  it("decide() still denies Write tool on a locked path (ISS-09 regression)", () => {
    expect(isExamLockedPath("tests/L0C/T11-readonly.spec.ts")).toBe(true);
    const out = decide({
      tool_name: "Write",
      tool_input: { file_path: "tests/L0C/T11-readonly.spec.ts" },
    });
    expect(out.deny).toBe(true);
    expect(out.reason).toBe(EXAM_LOCK_REASON);
  });
});
