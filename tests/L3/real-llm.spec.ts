// REAL-T01: RealLLMPort (pi headless) — 真实 fake-pi 二进制 + 真实 smoke skipIf
//
// 覆盖 spec（execution/adapt/TASKS.md §REAL-T01）的 Given/When/Then 全部场景：
//   1. spawn pi -p --model <m> 返回 stdout（fake pi，断言 argv）
//   2. 多行 + 特殊字符 prompt 经 stdin 管道传入（防 argv 注入）
//   3. 非零 exit 重试 maxRetries 次后 throw PiHeadlessError（断言 spawn 计数 N+1）
//   4. 超时 kill + throw PiHeadlessTimeout（不重试）
//   5. stdout 含 ANSI 转义 → strip 为纯文本
//   6. piBin 不存在（ENOENT）→ throw PiHeadlessError（exitCode=null）不重试
//   7. skipIf(!canSpawnPi): 真实 pi -p 往返返回含 "PONG"
//
// 测试策略（与 ADP-T02 同源裁决，见 TEST-LOCK.md §2.5 ADP-T02 重锁注记）：
//   vitest 的 vi.mock / vi.doMock / vi.spyOn 对 `node:child_process` 内建模块均
//   不生效（built-in 导出冻结 + 不经 vitest loader，mock factory 永不装配，已
//   实测确认）。故本文件**不依赖 vi.doMock**，改用"真实 fake pi 二进制"端到端
//   验证 spawn 语义：生成带 shebang 的 temp `.mjs`，由 RealLLMPort 真实 execve
//   spawn，记录 argv / spawn 计数 / stdin / SIGTERM marker。比 mock 更真实地
//   覆盖子进程语义（与 tests/adapt/T02-pi-adapter.spec.ts PiHeadlessLLM 测试、
//   tests/L0S/T06 真子进程测试同构）。
//
// 注意：fake pi 是 node ESM 脚本，启动有 ~250–600ms 延迟。超时用例的 timeoutMs
// 须显著大于启动延迟，确保 SIGTERM handler 在 kill 送达前已安装（marker 可写）。
//
// 门控：检测 pi CLI 可用性。CI 无 pi 时 smoke 自动跳过不红；fake pi 测试为主体。

import { describe, it, expect } from "vitest";
import { canSpawnPi } from "../adapt/pi-probe";
import {
  RealLLMPort,
  PiHeadlessError,
  PiHeadlessTimeout,
} from "@harness/l3-engine";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// pi CLI 可达性探测（smoke 门控）
// ---------------------------------------------------------------------------

function hasPiCli(): boolean {
  try {
    execSync("command -v pi >/dev/null 2>&1", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasPi = hasPiCli();

// ---------------------------------------------------------------------------
// Fake pi 二进制（端到端覆盖 spawn 语义；自包含，不依赖跨目录 fixture）
// ---------------------------------------------------------------------------

interface FakePiOpts {
  /** 成功时写入 stdout 的内容（默认 "MUTANT_JSON"）。 */
  readonly stdout?: string;
  /** 写入 stderr 的内容（默认 ""）。 */
  readonly stderr?: string;
  /** 退出码（默认 0）。hang=true 时忽略。 */
  readonly exitCode?: number;
  /** 挂死模式：忽略 exitCode，setInterval 挂住；收到 SIGTERM 写 marker 后 exit。 */
  readonly hang?: boolean;
}

interface FakePi {
  /** 传给 RealLLMPort 的 piBin 路径（可执行 .mjs）。 */
  readonly path: string;
  /** 每次 spawn 追加 "1\n" 的计数文件路径（断言 spawn 次数）。 */
  readonly counterFile: string;
  /** 成功 spawn 写入 JSON.stringify(process.argv.slice(2)) 的文件路径。 */
  readonly argvFile: string;
  /** spawn 后将 stdin 全文写入的文件路径（断言 prompt 经 stdin 传入）。 */
  readonly stdinFile: string;
  /** hang 模式收到 SIGTERM 时写入的 marker 文件路径。 */
  readonly markerFile: string;
  /** 读取 spawn 计数（已启动的 fake pi 进程数）。 */
  spawnCount(): number;
  /** 读取最后一次 spawn 的 argv（string[]）。 */
  readArgv(): string[];
  /** 读取最后一次 spawn 收到的 stdin 全文。 */
  readStdin(): string;
  /** marker 是否被写入（SIGTERM 是否送达）。 */
  markerWritten(): boolean;
  /** 销毁 temp 目录。 */
  destroy(): void;
}

function makeFakePi(opts: FakePiOpts = {}): FakePi {
  const dir = mkdtempSync(join(tmpdir(), "real-llm-fakepi-"));
  const path = join(dir, "pi-fake.mjs");
  const counterFile = join(dir, "counter.txt");
  const argvFile = join(dir, "argv.json");
  const stdinFile = join(dir, "stdin.txt");
  const markerFile = join(dir, "marker.txt");
  // 用 JSON 嵌入配置（JSON 是合法 JS 字面量，路径/字符串无需手动转义）
  const cfg = JSON.stringify({
    counterFile,
    argvFile,
    stdinFile,
    markerFile,
    stdout: opts.stdout ?? "MUTANT_JSON",
    stderr: opts.stderr ?? "",
    exitCode: opts.exitCode ?? 0,
    hang: opts.hang === true,
  });
  const script = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const cfg = ${cfg};
try { appendFileSync(cfg.counterFile, "1\\n"); } catch {}
try { writeFileSync(cfg.argvFile, JSON.stringify(process.argv.slice(2))); } catch {}
// 排空 stdin 防止管道反压；非 hang 模式在 stdin end 后写 stdin 文件 + 输出 + 退出。
let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { stdinBuf += d; });
if (cfg.hang) {
  process.stdin.on("end", () => {});
  process.on("SIGTERM", () => {
    try { writeFileSync(cfg.markerFile, "killed"); } catch {}
    process.exit(0);
  });
  setInterval(() => {}, 60000);
} else {
  process.stdin.on("end", () => {
    try { writeFileSync(cfg.stdinFile, stdinBuf); } catch {}
    if (cfg.stderr) process.stderr.write(cfg.stderr);
    process.stdout.write(cfg.stdout);
    process.exitCode = cfg.exitCode;
  });
}
`;
  writeFileSync(path, script, "utf8");
  chmodSync(path, 0o755);
  return {
    path,
    counterFile,
    argvFile,
    stdinFile,
    markerFile,
    spawnCount() {
      try {
        return readFileSync(counterFile, "utf8")
          .split("\n")
          .filter((l) => l === "1").length;
      } catch {
        return 0;
      }
    },
    readArgv() {
      try {
        return JSON.parse(readFileSync(argvFile, "utf8"));
      } catch {
        return [];
      }
    },
    readStdin() {
      try {
        return readFileSync(stdinFile, "utf8");
      } catch {
        return "";
      }
    },
    markerWritten() {
      return existsSync(markerFile);
    },
    destroy() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 轮询 marker 文件最多 ms 毫秒（容忍 SIGTERM 异步送达 + impl await-exit）。 */
async function waitForMarker(fake: FakePi, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fake.markerWritten()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fake.markerWritten();
}

describe("REAL-T01 · RealLLMPort (real fake-pi binary)", () => {
  it("spawns pi -p --model <m> and returns stdout", async () => {
    // Given fake pi 成功输出 stdout
    const fake = makeFakePi({ stdout: "MUTANT_JSON" });
    try {
      const port = new RealLLMPort({
        piBin: fake.path,
        model: "anthropic/claude-sonnet-4",
      });
      // When complete
      const out = await port.complete("produce mutation");
      // Then 返回 stdout
      expect(out).toBe("MUTANT_JSON");
      // And spawn argv 含 ['-p'] 与 '--model' <model>（fake pi 回写 argv）
      const argv = fake.readArgv();
      expect(argv).toContain("-p");
      const modelIdx = argv.indexOf("--model");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(argv[modelIdx + 1]).toBe("anthropic/claude-sonnet-4");
    } finally {
      fake.destroy();
    }
  });

  it("passes multi-line prompt via stdin pipe (not argv)", async () => {
    // Given fake pi 捕获 stdin 到文件
    const fake = makeFakePi({ stdout: "OK" });
    try {
      const port = new RealLLMPort({ piBin: fake.path, model: "m/x" });
      // Given 多行 + 特殊字符（-- 前缀）prompt
      const prompt = "line1\nline2\n--danger\n{json}";
      await port.complete(prompt);
      // Then prompt 经 stdin 传入（非 argv）
      expect(fake.readStdin()).toContain(prompt);
      // And argv 不含 prompt 字面（防 argv 注入）
      const argv = fake.readArgv();
      expect(argv.some((a) => a.includes("line1"))).toBe(false);
    } finally {
      fake.destroy();
    }
  });

  it("retries on non-zero exit then throws PiHeadlessError (maxRetries=2 → 3 calls)", async () => {
    // Given fake pi 每次 exit code=2 + stderr
    const fake = makeFakePi({ stdout: "", stderr: "pi boom", exitCode: 2 });
    try {
      const port = new RealLLMPort({
        piBin: fake.path,
        model: "m/x",
        maxRetries: 2,
        timeoutMs: 5000,
      });
      // When/Then complete 重试 2 次后 throw PiHeadlessError
      let caught: unknown;
      try {
        await port.complete("x");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PiHeadlessError);
      // spawn 调用 3 次（首次 + 2 重试，fake pi 计数文件佐证）
      expect(fake.spawnCount()).toBe(3);
      // PiHeadlessError 含 stderr + exitCode
      if (caught instanceof PiHeadlessError) {
        expect(caught.exitCode).toBe(2);
        expect(caught.stderr).toContain("pi boom");
      }
    } finally {
      fake.destroy();
    }
  });

  it("kills + throws PiHeadlessTimeout on timeout (no retry)", async () => {
    // Given fake pi 挂死（setInterval，收到 SIGTERM 写 marker）
    const fake = makeFakePi({ hang: true });
    try {
      const port = new RealLLMPort({
        piBin: fake.path,
        model: "m/x",
        // timeoutMs 须 > fake pi node 启动延迟（~250–600ms），确保 SIGTERM
        // handler 在 kill 送达前已安装（marker 可写）。
        timeoutMs: 2000,
        maxRetries: 3,
      });
      // When/Then complete 超时 → throw PiHeadlessTimeout
      await expect(port.complete("x")).rejects.toBeInstanceOf(PiHeadlessTimeout);
      // And kill（SIGTERM）送达：marker 被写入
      expect(await waitForMarker(fake)).toBe(true);
      // And 不重试（spawn 只调一次）
      expect(fake.spawnCount()).toBe(1);
    } finally {
      fake.destroy();
    }
  });

  it("strips ANSI escape codes from stdout", async () => {
    // Given stdout 含 ANSI 转义码
    const ansi = "\x1b[31mRED\x1b[0m \x1b[1;32mGREEN\x1b[0m";
    const fake = makeFakePi({ stdout: ansi });
    try {
      const port = new RealLLMPort({ piBin: fake.path, model: "m/x" });
      const out = await port.complete("x");
      // Then 已 strip 为纯文本
      expect(out).toBe("RED GREEN");
      expect(out).not.toContain("\x1b");
    } finally {
      fake.destroy();
    }
  });

  it("throws PiHeadlessError on ENOENT without retry", async () => {
    // Given piBin 指向绝对不存在的路径 → spawn 异步 'error' ENOENT
    const noBin = join(tmpdir(), `nonexistent-pi-${Date.now()}-${process.pid}`);
    const port = new RealLLMPort({
      piBin: noBin,
      maxRetries: 3,
      timeoutMs: 5000,
    });
    // When/Then throw PiHeadlessError（exitCode=null）不重试
    let caught: unknown;
    try {
      await port.complete("x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PiHeadlessError);
    // 注：ENOENT 时 fake pi 从未启动，无法用计数文件断言 spawn 次数；
    // "不重试"由实现 spawnError 分支保证（spawnOnce 'error' 事件 → 立即抛出，
    // 不进入重试循环）。此处断言错误字段佐证走的是 spawn-error 路径。
    if (caught instanceof PiHeadlessError) {
      expect(caught.exitCode).toBeNull();
      expect(caught.stderr).toContain("ENOENT");
    }
  });
});

// ---------------------------------------------------------------------------
// 真实 pi -p 往返 smoke（skipIf 无 pi 环境）
// ---------------------------------------------------------------------------

describe("REAL-T01 · real pi -p smoke", () => {
  it.skipIf(!canSpawnPi)(
    "real pi -p roundtrip returns PONG",
    async () => {
      const port = new RealLLMPort({
        piBin: "pi",
        timeoutMs: 120_000,
        maxRetries: 1,
      });
      const out = await port.complete("Reply with exactly: PONG");
      expect(out).toContain("PONG");
    },
    150_000,
  );
});
