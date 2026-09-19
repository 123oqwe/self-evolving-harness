// CLN-T02 · L0C-T02 verify.sh Form B 突变门实现 [Wave 2]
//
// Spec: execution/cleanup/TASKS.md §CLN-T02
// SUT: scripts/lib/mutate-invariant.sh（新增 helper）
//
// 任务背景：L0C-T02 的 Form B 突变门此前因 vitest include glob 工程障碍被
// 简化为纯 Form A。本任务实现 `scripts/lib/mutate-invariant.sh`：在隔离
// vitest 进程里对锁定 spec 的 *tmp 副本* 注入孤儿 `tool_result`，期望 tmp
// 副本 fail（不变量捕获孤儿），恢复后原 spec pass。两步符合预期 = 门通过。
//
// RED 形态（当前）：helper 尚未实现 → `bash scripts/lib/mutate-invariant.sh
// L0C-T02-orphan` exit≠0（命令/文件不存在）→ 全部 RED。
//
// 铁律：突变打在 tmp 副本，绝不写回 tests/L0C/T02-turn.spec.ts（写回 =
// test-lock-violation）。本测试用 sha256 自检锁定文件未被破坏。
//
// 断言逻辑在实现完成后能真正检验行为：测 helper 的 exit code + 锁定文件
// sha256 不变 + 无 tmp 残留（幂等），不测 helper 内部实现。

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const HELPER = resolve(REPO_ROOT, "scripts/lib/mutate-invariant.sh");
const LOCKED_SPEC = resolve(REPO_ROOT, "tests/L0C/T02-turn.spec.ts");

/** 运行 helper 并返回退出码（不抛异常）。 */
function runHelper(variant: string, timeoutMs = 120_000): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const out = execFileSync(
      "bash",
      [HELPER, variant],
      {
        cwd: REPO_ROOT,
        timeout: timeoutMs,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "1" },
      },
    );
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    const err = e as {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      code: typeof err.status === "number" ? err.status : 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 列出 tests/L0C 下的文件名（用于检测 tmp 副本残留）。 */
function listL0CDir(): string[] {
  return readdirSync(resolve(REPO_ROOT, "tests/L0C")).sort();
}

describe("CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan）", () => {
  const VARIANT = "L0C-T02-orphan";

  it("Given 锁定 spec GREEN，When mutate-invariant.sh L0C-T02-orphan，Then helper exit 0（注入 fail + 恢复 pass）", () => {
    // G/W/T1：注入孤儿 tool_result → tmp 副本 fail（exit≠0，不变量捕获）；
    // 恢复后原 spec pass（exit 0）；两步符合预期 → helper exit 0。
    const result = runHelper(VARIANT);
    if (result.code !== 0) {
      // RED 诊断：打印 helper 输出便于定位（实现缺失或门失败）。
      console.error(
        `[CLN-T02] helper exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    expect(result.code).toBe(0);
  });

  it("Given helper 跑完，When 比对锁定文件 sha256，Then 与运行前一致（不破坏锁定 = test-lock 未破）", () => {
    // G/W/T3：helper 不得写回锁定文件。前后 sha256 必须相同。
    const before = sha256(LOCKED_SPEC);
    const beforeDir = listL0CDir();

    const result = runHelper(VARIANT);
    expect(result.code).toBe(0);

    const after = sha256(LOCKED_SPEC);
    expect(after).toBe(before);
    // 目录内容不增（无 tmp 副本残留写回 tests/L0C）。
    expect(listL0CDir()).toEqual(beforeDir);
  });

  it("Given helper 幂等（连续两次），When 跑两次，Then 两次均 exit 0 且无 tmp 残留污染", () => {
    // G/W/T2：finally 块清理 tmp 副本，不留污染，幂等可重复。
    const r1 = runHelper(VARIANT);
    expect(r1.code).toBe(0);
    const dirAfter1 = listL0CDir();

    const r2 = runHelper(VARIANT);
    expect(r2.code).toBe(0);

    // 第二次跑完目录快照与第一次跑完一致 → 无累积残留。
    expect(listL0CDir()).toEqual(dirAfter1);
  });

  it("Given 未实现的 variant，When mutate-invariant.sh <unknown>，Then exit≠0（variant 表化：未知 variant 拒绝）", () => {
    // variant 表化（REFACTOR 目标）：未注册的 variant 必须拒绝，不得静默 pass。
    const result = runHelper("CLN-T02-unknown-variant-does-not-exist");
    expect(result.code).not.toBe(0);
  });
});
