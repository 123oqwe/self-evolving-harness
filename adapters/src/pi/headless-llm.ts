// ADP-T02: PiHeadlessLLM — LLMPort via 子进程 `pi -p` 无头调用。
//
// Spec: execution/adapt/TASKS.md §ADP-T02 (headless-llm.ts).
// 复用铁律（§0.2）：`LLMPort` 接口从 `@harness/l3-engine` 导入，不重造。
//
// pi 无头调用契约（pi README §Modes/§Model Options/§Print mode）：
//  - `-p`/`--print`：print mode，打印响应后退出。
//  - `--model <pattern>`：模型 pattern，支持 `provider/id` 与 `:<thinking>` 后缀。
//  - print mode 读 piped stdin 合并入初始 prompt；stdin-only 无 prompt 参数亦生效。
//  - 非交互模式不显示 trust prompt。
//
// spawn argv：`model ? ['-p','--model',model] : ['-p']`（不传 `'--','-'` 占位符——
// pi print mode 会把 `-` 当字面 prompt 合并入初始 prompt 污染 LLM 输入，已实测
// `printf 'Just say HI' | pi -p -- -` 返回 `HI-`）。prompt 经 stdin pipe 传入。
// 超时用 setTimeout + proc.kill('SIGTERM')；非零 exit（非超时）重试 maxRetries 次。

import { spawn } from "node:child_process";
import type { LLMPort } from "@harness/l3-engine";

/** PiHeadlessLLM 选项。 */
export interface PiHeadlessLLMOptions {
  /** pi 二进制路径，默认 'pi'。测试可注入 fake pi 路径。 */
  readonly piBin?: string;
  /** `--model` pattern，如 'anthropic/claude-sonnet-4:high'。缺省用 pi 默认 model。 */
  readonly model?: string;
  /** 单次调用超时（毫秒），默认 60_000。 */
  readonly timeoutMs?: number;
  /** 非超时、非零 exit 的重试次数，默认 2。 */
  readonly maxRetries?: number;
}

/** pi 子进程非零 exit（重试耗尽后抛出）。 */
export class PiHeadlessError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(
    msg: string,
    opts: { stderr: string; exitCode: number | null },
  ) {
    super(msg);
    this.name = "PiHeadlessError";
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

/** pi 子进程超时（不可重试，kill 后抛出）。 */
export class PiHeadlessTimeout extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PiHeadlessTimeout";
  }
}

/**
 * strip ANSI 转义码（正则，无新依赖）。pi -p 输出可能含 ANSI 转义。
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

interface SpawnOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

/**
 * 子进程启动宽限（boot grace）。
 *
 * `pi -p`（与测试用的 fake-pi 二进制）都是 Node 脚本，spawn 后需 ~300–500ms
 * 完成 V8 启动 + 脚本顶层执行 + 注册 SIGTERM 处理器，之后才进入事件循环。
 * 在此之前子进程的信号 disposition 是默认值（SIGTERM = 直接终止），JS 层
 * 注册的 `process.on("SIGTERM")` 处理器尚未生效。
 *
 * 若把 timeoutMs 当作自 spawn 起算的墙钟，超时 SIGTERM 可能在子进程 boot
 * 完成前送达 → 默认 disposition 杀死子进程，JS 信号处理器（含清理 / marker
 * 写入）永不执行。boot grace 把 timeoutMs 语义从「自 spawn 起算」改为
 * 「自子进程 boot 完成起算的响应超时」：boot 期间子进程若正常 exit 仍立即
 * resolve（不阻塞），只有 boot 后仍未退出才计入 timeoutMs。这样 SIGTERM 总
 * 能送达一个已 boot、信号处理器已就绪的子进程，清理逻辑得以执行。
 */
const BOOT_GRACE_MS = 2000;

/**
 * 单次 spawn pi -p，写 prompt 到 stdin，捕获 stdout/stderr，超时 kill。
 * 返回结果（不重试——重试逻辑在 complete 内）。
 */
function spawnPiOnce(opts: {
  piBin: string;
  args: string[];
  prompt: string;
  timeoutMs: number;
}): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(opts.piBin, opts.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    // 我们因超时主动发起 SIGTERM；此后无论子进程以何种 code/signal 退出，
    // 一律视为 timedOut（子进程的 SIGTERM 处理器可能调用 process.exit(0)，
    // 不能让 exit code 0 把超时误判为成功）。
    let killing = false;
    let bootTimer: ReturnType<typeof setTimeout> | undefined;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      if (bootTimer) clearTimeout(bootTimer);
      if (responseTimer) clearTimeout(responseTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      resolve(outcome);
    };

    const timeoutOutcome = (): SpawnOutcome => ({
      stdout,
      stderr,
      exitCode: null,
      timedOut: true,
    });

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    // boot grace：给子进程时间启动并注册信号处理器。boot 期间子进程若 exit
    // 则由 exit handler 立即 resolve（不阻塞）；boot 后仍未退出才启动响应超时。
    bootTimer = setTimeout(() => {
      bootTimer = undefined;
      // 响应超时：timeoutMs 自 boot 完成起算。到期 → SIGTERM（送达已 boot 的
      // 子进程，其 JS 信号处理器可执行清理）+ await exit 防 zombie。
      responseTimer = setTimeout(() => {
        responseTimer = undefined;
        killing = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        // 给子进程时间收敛 exit 事件；若 SIGTERM 被忽略则强制以 timedOut 结束。
        killGraceTimer = setTimeout(() => {
          finish(timeoutOutcome());
        }, 500);
      }, opts.timeoutMs);
    }, BOOT_GRACE_MS);

    proc.on("error", (err: NodeJS.ErrnoException) => {
      // spawn ENOENT 等：视为非零 exit，stderr 记错误信息。
      finish({
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + err.message,
        exitCode: null,
        timedOut: false,
      });
    });

    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      // 因超时主动 SIGTERM 的退出：一律 timedOut（见 killing 注释）。
      if (killing) {
        finish(timeoutOutcome());
        return;
      }
      // 被外部信号杀死（非本 impl 发起）：视为超时。
      if (signal && !settled) {
        finish(timeoutOutcome());
        return;
      }
      finish({ stdout, stderr, exitCode: code, timedOut: false });
    });

    // 写 prompt 到 stdin（pi print mode 合并 stdin 入初始 prompt）。
    try {
      proc.stdin.write(opts.prompt, "utf8");
      proc.stdin.end();
    } catch {
      /* stdin 已关闭则忽略 */
    }
  });
}

/**
 * 真实 LLMPort：子进程 `pi -p --model <m>`，捕获 stdout，超时 kill，非零 exit 重试。
 */
export class PiHeadlessLLM implements LLMPort {
  private readonly piBin: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: PiHeadlessLLMOptions = {}) {
    this.piBin = opts.piBin ?? "pi";
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async complete(prompt: string): Promise<string> {
    const args: string[] = this.model
      ? ["-p", "--model", this.model]
      : ["-p"];
    let lastStderr = "";
    let lastExit: number | null = null;

    // 首次 + maxRetries 重试 = maxRetries+1 次 spawn。
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const outcome = await spawnPiOnce({
        piBin: this.piBin,
        args,
        prompt,
        timeoutMs: this.timeoutMs,
      });
      // 超时：不可重试，直接抛 PiHeadlessTimeout。
      if (outcome.timedOut) {
        throw new PiHeadlessTimeout(
          `pi -p timed out after ${this.timeoutMs}ms`,
        );
      }
      // 成功 exit 0：返回 strip 后的 stdout。
      if (outcome.exitCode === 0) {
        return stripAnsi(outcome.stdout);
      }
      // 非零 exit：记录，若仍有重试额度则继续，否则抛 PiHeadlessError。
      lastStderr = outcome.stderr;
      lastExit = outcome.exitCode;
    }
    throw new PiHeadlessError(
      `pi -p exited non-zero (exitCode=${lastExit}) after ${this.maxRetries + 1} attempt(s)`,
      { stderr: lastStderr, exitCode: lastExit },
    );
  }
}
