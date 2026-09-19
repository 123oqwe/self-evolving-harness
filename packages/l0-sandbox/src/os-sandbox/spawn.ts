/**
 * L0S-T02 — 子进程执行共享工具
 *
 * 单次连续 run 捕获 stdout+stderr（spec 契约：禁跨 run 合并）。
 * 硬 timeout 到期 → SIGKILL 子进程，exitCode=124。teardown 的进程组清理由 L0S-T06 协同。
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants as osConstants } from "node:os";

/** 信号名 → 信号号 反查表（os.constants.signals 为 名→号 映射）。 */
const SIGNAL_NUM: ReadonlyMap<string, number> = new Map(
  Object.entries(osConstants.signals).map(([name, num]) => [name, num as number]),
);

/**
 * 子进程被信号致死的退出码映射：128 + signum（shell 惯例）。code 为 null 且
 * 收到 signal 时旧实现回退 0——把被杀死的进程谎报为成功（round 2 缺陷 4）。
 */
function exitCodeFromClose(code: number | null, signal: string | null): number {
  if (code !== null) return code;
  if (signal !== null) {
    const signum = SIGNAL_NUM.get(signal);
    if (signum !== undefined) return 128 + signum;
    return 128;
  }
  return 0;
}

export interface RunShellOptions {
  cwd: string;
  timeout_ms: number;
  env?: NodeJS.ProcessEnv;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * 执行 `argv`，捕获 stdout/stderr，超时 SIGKILL。
 *
 * 注：调用方若需进程组语义（T06 finally{kill}），应以 `detached:true` 生成
 * 并在 argv 中自备进程组 leader；本工具仅做单进程捕获。
 */
export function runShell(argv: string[], opts: RunShellOptions): Promise<ShellResult> {
  return new Promise((resolve) => {
    const bin = argv[0] ?? "sh";
    const child: ChildProcess = spawn(bin, argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, opts.timeout_ms);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: stderr + String(err),
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        // 超时 SIGKILL 保留 124 惯例；其余信号致死映射 128+signum，绝不归 0。
        exitCode: timedOut ? 124 : exitCodeFromClose(code, signal),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
