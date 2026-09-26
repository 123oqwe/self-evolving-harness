// REAL-T01: RealLLMPort (pi headless) — 真实 LLM 调用 via `pi -p` 子进程.
//
// Spec: execution/adapt/TASKS.md §REAL-T01.
//
// 复用铁律（§0.2）：`LLMPort` 接口来自 §L3-T03（`../reflective-mutation.js`），
// 本文件只做 pi headless 实现，不重造接口。pi headless 调用契约参考 pi README：
//   - `-p`/`--print` print mode（打印响应后退出）
//   - `--model <pattern>` 支持 `provider/id` 与 `:<thinking>` 后缀
//   - stdin 管道合并入初始 prompt（stdin-only 无 prompt 参数亦生效）
//   - 非交互模式不显示 trust prompt
//
// 实现要点（spec §GREEN）：
//   - 用 `spawn`（非 exec）：便于超时 kill + 流式累积 stdout/stderr
//   - `args = model ? ['-p','--model',model] : ['-p']`；**不**传 `'--','-'` 占位符
//     （pi print mode 会把 `-` 当字面 prompt 合并入初始 prompt 污染 LLM 输入）
//   - prompt 经 stdin 管道传入（防 argv 注入 + 避开 argv 长度上限）
//   - 超时用 setTimeout + proc.kill('SIGTERM')，kill 后 await exit 事件防 zombie
//   - 非零 exit（非超时）→ 重试 maxRetries 次；超时不可重试
//   - ENOENT/EACCES 等 spawn 错误（同步抛或异步 'error' 事件）→ PiHeadlessError
//     (exitCode=null) **不重试**（spec §错误路径）
//   - ANSI strip 用正则 `/\x1b\[[0-9;]*m/g`
//
// 测试策略说明（与 ADP-T02 同源裁决，见 TEST-LOCK.md §2.5 ADP-T02 重锁注记）：
//   vitest 的 vi.mock / vi.doMock / vi.spyOn 对 `node:child_process` 内建模块均
//   不生效（built-in 导出冻结 + 不经 vitest loader，mock factory 永不装配）。
//   故本模块使用**静态 import**（与 adapters/src/pi/headless-llm.ts 同构），
//   REAL-T01 测试改用"真实 fake pi 二进制"端到端验证 spawn 语义（与 ADP-T02
//   PiHeadlessLLM 测试同构），不依赖 vi.doMock。

import { spawn } from "node:child_process";
import type { LLMPort } from "../reflective-mutation.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RealLLMPortOptions {
  /** pi 可执行文件路径或名（默认 'pi'）。 */
  readonly piBin?: string;
  /** `--model` pattern，如 'anthropic/claude-sonnet-4:high'。缺省不传 --model。 */
  readonly model?: string;
  /** 单次调用超时（ms，默认 120_000）。超时不可重试。 */
  readonly timeoutMs?: number;
  /** 非超时、非零 exit 的重试次数（默认 2，即首次 + 2 重试 = 最多 3 次 spawn）。 */
  readonly maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** pi 子进程非零 exit（重试耗尽）或 spawn 错误（ENOENT/EACCES）。 */
export class PiHeadlessError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(
    message: string,
    opts: { stderr: string; exitCode: number | null },
  ) {
    super(message);
    this.name = "PiHeadlessError";
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

/** pi 子进程超时（timeoutMs 内未退出），已 SIGTERM kill，不可重试。 */
export class PiHeadlessTimeout extends Error {
  readonly timeoutMs: number;
  constructor(message: string, opts: { timeoutMs: number }) {
    super(message);
    this.name = "PiHeadlessTimeout";
    this.timeoutMs = opts.timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// 纯函数 helper（spec §REFACTOR）
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** strip stdout 中的 ANSI 颜色转义码。 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// ---------------------------------------------------------------------------
// 单次 spawn 结果
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** spawn 错误（ENOENT/EACCES 等同步或异步 spawn 失败）。非空 = 不可重试。 */
  readonly spawnError?: { readonly code: string; readonly message: string };
}

// ---------------------------------------------------------------------------
// RealLLMPort
// ---------------------------------------------------------------------------

/**
 * 真实 LLMPort：子进程 `pi -p --model <m>`，捕获 stdout，超时 kill，非零 exit
 * 重试。满足 `LLMPort.complete(prompt): Promise<string>`。
 */
export class RealLLMPort implements LLMPort {
  private readonly piBin: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts?: RealLLMPortOptions) {
    this.piBin = opts?.piBin ?? "pi";
    this.model = opts?.model;
    this.timeoutMs = opts?.timeoutMs ?? 120_000;
    this.maxRetries = opts?.maxRetries ?? 2;
  }

  async complete(prompt: string): Promise<string> {
    const argv: string[] = this.model
      ? ["-p", "--model", this.model]
      : ["-p"];

    let lastStderr = "";
    let lastExit: number | null = null;

    // 首次 + 最多 maxRetries 次重试 = maxRetries+1 次 spawn（仅对非超时非零 exit）。
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const outcome = await this.spawnOnce(argv, prompt);
      // 超时：不可重试——直接抛。
      if (outcome.timedOut) {
        throw new PiHeadlessTimeout(
          `pi headless timeout after ${this.timeoutMs}ms`,
          { timeoutMs: this.timeoutMs },
        );
      }
      // spawn 错误（ENOENT/EACCES）：不可重试——直接抛 PiHeadlessError。
      if (outcome.spawnError) {
        throw new PiHeadlessError(
          `pi spawn failed (${outcome.spawnError.code}): ${this.piBin}`,
          {
            stderr: `${outcome.spawnError.code}: ${outcome.spawnError.message}`,
            exitCode: null,
          },
        );
      }
      if (outcome.exitCode !== 0) {
        // 非零 exit：记录供重试耗尽后报错，进入下一轮重试。
        lastStderr = outcome.stderr;
        lastExit = outcome.exitCode;
        continue;
      }
      // 成功：strip ANSI 返回。
      return stripAnsi(outcome.stdout);
    }

    // 重试耗尽。
    throw new PiHeadlessError(
      `pi headless non-zero exit after ${this.maxRetries + 1} attempt(s)`,
      { stderr: lastStderr, exitCode: lastExit },
    );
  }

  /**
   * 跑一次 pi 子进程：写 prompt 到 stdin，累积 stdout/stderr，超时 kill。
   * 返回 SpawnOutcome（不重试——重试逻辑在 complete 内）。
   */
  private spawnOnce(
    argv: readonly string[],
    prompt: string,
  ): Promise<SpawnOutcome> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.piBin, argv, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        // spawn 同步抛（典型 ENOENT：piBin 不存在）→ 不可重试。
        const err = e as NodeJS.ErrnoException;
        resolve({
          stdout: "",
          stderr: `${err?.code ?? "ERR"}: ${err?.message ?? String(e)}`,
          exitCode: null,
          timedOut: false,
          spawnError: {
            code: err?.code ?? "ERR",
            message: err?.message ?? String(e),
          },
        });
        return;
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      let grace: NodeJS.Timeout | undefined;

      const finish = (result: SpawnOutcome) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (grace) clearTimeout(grace);
        resolve(result);
      };

      child.stdout?.on("data", (d: Buffer) => stdoutChunks.push(d));
      child.stderr?.on("data", (d: Buffer) => stderrChunks.push(d));

      // spawn 异步错误（ENOENT/EACCES 在多数平台异步触发）→ 不可重试。
      child.once("error", (e: NodeJS.ErrnoException) => {
        finish({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr:
            Buffer.concat(stderrChunks).toString("utf8") ||
            `${e.code ?? "ERR"}: ${e.message}`,
          exitCode: null,
          timedOut: false,
          spawnError: {
            code: e.code ?? "ERR",
            message: e.message,
          },
        });
      });

      // 单一 exit 处理器：超时标志优先（防超时 kill 后 child 以 code=0 退出
      // 被误判为成功）。
      child.once("exit", (code: number | null) => {
        finish({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: timedOut ? null : code,
          timedOut,
        });
      });

      // 写 prompt 到 stdin 后 end（stdin-only 无 prompt 参数经实测生效）。
      try {
        child.stdin?.write(prompt);
        child.stdin?.end();
      } catch {
        // stdin 写失败不致命——stdout 可能仍可读。
      }

      timer = setTimeout(() => {
        // 超时：置标志 + SIGTERM kill + 等 exit 事件防 zombie。
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // kill 失败不致命——exit 仍会以 timedOut 结案。
        }
        // 宽限：若 kill 后进程迟迟不 exit（2s），强制以 timedOut 结案。
        grace = setTimeout(() => {
          finish({
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode: null,
            timedOut: true,
          });
        }, 2000);
        grace.unref?.();
      }, this.timeoutMs);
      // 超时定时器不阻塞进程退出。
      timer.unref?.();
    });
  }
}
