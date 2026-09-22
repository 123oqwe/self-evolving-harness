// REAL-T01: RealLLMPort (pi headless) — mock 子进程 + 真实 smoke skipIf
//
// 覆盖 spec（execution/adapt/TASKS.md §REAL-T01）的 Given/When/Then 全部场景：
//   1. spawn pi -p --model <m> 返回 stdout（mock，断言 argv）
//   2. 多行 + 特殊字符 prompt 经 stdin 管道传入（防 argv 注入）
//   3. 非零 exit 重试 maxRetries 次后 throw PiHeadlessError（断言 spawn 调用 N+1 次）
//   4. 超时 kill + throw PiHeadlessTimeout（不重试）
//   5. stdout 含 ANSI 转义 → strip 为纯文本
//   6. piBin 不存在（ENOENT）→ throw PiHeadlessError（exitCode=null）不重试
//   7. skipIf(!hasPi): 真实 pi -p 往返返回含 "PONG"
//
// 门控：检测 pi CLI 可用性。CI 无 pi 时 smoke 自动跳过不红；mock 子进程测试为主体。
// RED state: @harness/l3-engine 未导出 RealLLMPort → import 失败 = 合法 RED。
//
import { describe, it, expect, vi } from "vitest";
import {
  RealLLMPort,
  PiHeadlessError,
  PiHeadlessTimeout,
} from "@harness/l3-engine";
import { hasPiCli } from "../adapt/fixtures/helpers";

const hasPi = hasPiCli();

// ---------------------------------------------------------------------------
// mock child_process 辅助
// ---------------------------------------------------------------------------

interface MockChild {
  stdout: { on: (ev: string, cb: (d: Buffer) => void) => void };
  stderr: { on: (ev: string, cb: (d: Buffer) => void) => void };
  stdin: { write: (d: unknown) => void; end: () => void };
  on: (ev: string, cb: (...a: unknown[]) => void) => void;
  kill: (sig?: string) => void;
  pid?: number;
}

function makeChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  neverExit?: boolean;
}): MockChild {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  const child: MockChild = {
    stdout: {
      on: (ev, cb) => {
        if (ev === "data" && opts.stdout) cb(Buffer.from(opts.stdout));
      },
    },
    stderr: {
      on: (ev, cb) => {
        if (ev === "data" && opts.stderr) cb(Buffer.from(opts.stderr));
      },
    },
    stdin: {
      write: () => {},
      end: () => {},
    },
    on: (ev, cb) => {
      (handlers[ev] ??= []).push(cb);
    },
    kill: vi.fn(),
  };
  if (!opts.neverExit) {
    setImmediate(() => {
      (handlers["exit"] ?? []).forEach((cb) =>
        cb(opts.exitCode ?? 0, null),
      );
    });
  }
  return child;
}

describe("REAL-T01 · RealLLMPort (mock child_process)", () => {
  it("spawns pi -p --model <m> and returns stdout", async () => {
    const child = makeChild({ stdout: "MUTANT_JSON" });
    const spawnSpy = vi.fn(() => child);
    vi.doMock("node:child_process", { spawn: spawnSpy });
    const port = new RealLLMPort({
      piBin: "pi",
      model: "anthropic/claude-sonnet-4",
    });
    const out = await port.complete("produce mutation");
    // Then 返回 stdout
    expect(out).toBe("MUTANT_JSON");
    // And spawn argv 含 ['-p'] 与 '--model' <model>
    expect(spawnSpy).toHaveBeenCalled();
    const argv = spawnSpy.mock.calls[0]![1] as string[];
    expect(argv).toContain("-p");
    const modelIdx = argv.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(argv[modelIdx + 1]).toBe("anthropic/claude-sonnet-4");
    vi.doUnmock("node:child_process");
  });

  it("passes multi-line prompt via stdin pipe (not argv)", async () => {
    const stdinWrites: string[] = [];
    const child = makeChild({ stdout: "OK" });
    child.stdin.write = (d: unknown) => {
      stdinWrites.push(String(d));
    };
    const spawnSpy = vi.fn(() => child);
    vi.doMock("node:child_process", { spawn: spawnSpy });
    const port = new RealLLMPort({ piBin: "pi", model: "m/x" });
    // Given 多行 + 特殊字符（-- 前缀）prompt
    const prompt = "line1\nline2\n--danger\n{json}";
    await port.complete(prompt);
    // Then prompt 经 stdin 传入（非 argv）
    const joined = stdinWrites.join("");
    expect(joined).toContain(prompt);
    // And argv 不含 prompt 字面（防 argv 注入）
    const argv = spawnSpy.mock.calls[0]![1] as string[];
    expect(argv.some((a) => a.includes("line1"))).toBe(false);
    vi.doUnmock("node:child_process");
  });

  it("retries on non-zero exit then throws PiHeadlessError (maxRetries=2 → 3 calls)", async () => {
    const spawnSpy = vi.fn(() =>
      makeChild({ stdout: "", stderr: "pi boom", exitCode: 2 }),
    );
    vi.doMock("node:child_process", { spawn: spawnSpy });
    const port = new RealLLMPort({
      piBin: "pi",
      model: "m/x",
      maxRetries: 2,
      timeoutMs: 5000,
    });
    // When/Then 重试 2 次后 throw PiHeadlessError
    let caught: unknown;
    try {
      await port.complete("x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PiHeadlessError);
    // spawn 调用 3 次（首次 + 2 重试）
    expect(spawnSpy.mock.calls.length).toBe(3);
    if (caught instanceof PiHeadlessError) {
      expect(caught.exitCode).toBe(2);
      expect(caught.stderr).toContain("pi boom");
    }
    vi.doUnmock("node:child_process");
  });

  it("kills + throws PiHeadlessTimeout on timeout (no retry)", async () => {
    const killSpy = vi.fn();
    const child = makeChild({ neverExit: true });
    child.kill = killSpy;
    const spawnSpy = vi.fn(() => child);
    vi.doMock("node:child_process", { spawn: spawnSpy });
    const port = new RealLLMPort({
      piBin: "pi",
      model: "m/x",
      timeoutMs: 50,
      maxRetries: 3,
    });
    // When/Then 超时 → PiHeadlessTimeout
    await expect(port.complete("x")).rejects.toBeInstanceOf(PiHeadlessTimeout);
    // And kill 被调
    expect(killSpy).toHaveBeenCalled();
    // And 不重试（spawn 只 1 次）
    expect(spawnSpy.mock.calls.length).toBe(1);
    vi.doUnmock("node:child_process");
  });

  it("strips ANSI escape codes from stdout", async () => {
    // Given stdout 含 ANSI 转义码
    const ansi = "\x1b[31mRED\x1b[0m \x1b[1;32mGREEN\x1b[0m";
    const child = makeChild({ stdout: ansi });
    vi.doMock("node:child_process", { spawn: () => child });
    const port = new RealLLMPort({ piBin: "pi", model: "m/x" });
    const out = await port.complete("x");
    // Then 已 strip 为纯文本
    expect(out).toBe("RED GREEN");
    expect(out).not.toContain("\x1b");
    vi.doUnmock("node:child_process");
  });

  it("throws PiHeadlessError on ENOENT without retry", async () => {
    // Given spawn 抛 ENOENT（piBin 不存在）
    const spawnSpy = vi.fn(() => {
      throw Object.assign(new Error("spawn pi ENOENT"), { code: "ENOENT" });
    });
    vi.doMock("node:child_process", { spawn: spawnSpy });
    const port = new RealLLMPort({
      piBin: "pi-no-such-bin",
      maxRetries: 3,
    });
    // When/Then throw PiHeadlessError（exitCode=null）不重试
    let caught: unknown;
    try {
      await port.complete("x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PiHeadlessError);
    expect(spawnSpy.mock.calls.length).toBe(1); // 不重试
    if (caught instanceof PiHeadlessError) {
      expect(caught.exitCode).toBeNull();
      expect(caught.stderr).toContain("ENOENT");
    }
    vi.doUnmock("node:child_process");
  });
});

// ---------------------------------------------------------------------------
// 真实 pi -p 往返 smoke（skipIf 无 pi 环境）
// ---------------------------------------------------------------------------

describe("REAL-T01 · real pi -p smoke", () => {
  it.skipIf(!hasPi)(
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
