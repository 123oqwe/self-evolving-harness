// TL-T04: replay 复现率采集（fresh sandbox 重放 + 非确定 action 持久 setup）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T04）的 Given/When/Then 全部场景：
//   1. 确定性 session exit code 复现 → reproduced = (replayExitCode===originalExitCode)
//   2. 非确定 action（网络调用）无 setupScript → 列入 nondeterministicActions，
//      reproduced=false（不静默假复现）
//   3. setupScript 注入后确定性恢复 → reproduced 由 exit code 决定
//   4. transcript 损坏（orphaned tool_use_id）→ TranscriptCorruptError，不尝试部分重放
//   5. measureReproRate：10 个 session 6 复现 → {reproduced:6, total:10, rate:0.6}
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReplayHarness,
  createTranscriptWriter,
} from "@harness/telemetry";
import type {
  ReplayHarness,
  ReplayResult,
  SandboxHandle,
  TranscriptWriter,
  TranscriptNode,
  NormalizedContent,
  Usage,
} from "@harness/telemetry";
import { TranscriptCorruptError } from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 ReplayHarness / ReplayResult 公共接口，但 SandboxHandle 类型、
// replay 如何读取 transcript、如何确定 originalExitCode、非确定 action 判定规则、
// 工厂签名均未在 spec 显式定义。此处按最小可工作假设（见文末 ambiguities）：
//   - 工厂 createReplayHarness({ transcript, sandboxFactory, deterministicTools,
//     getOriginalExitCode }) 注入 transcript 源（TranscriptWriter.loadSession +
//     verifyTree）、按 sessionId 生产 fresh sandbox 的工厂、确定性工具白名单、
//     以及可选的 originalExitCode 查询回调。
//   - SandboxHandle 假设接口：{ execute(command): Promise<{exitCode,stdout,stderr}> }，
//     replay 从 transcript 的 tool_use 节点提取命令并在 sandbox.execute 执行，
//     收集 exit code 作为 replayExitCode。
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4.5";
const VERSION = "0.1.0";
const GIT = "main";
const CWD = "/tmp/tl-t04-proj";

function textContent(text: string): NormalizedContent {
  return [{ type: "text", text }] as unknown as NormalizedContent;
}

function toolUseBlock(id: string, name: string, input: unknown): unknown {
  return { type: "tool_use", id, name, input };
}

function toolResultBlock(id: string, isError = false): unknown {
  return { type: "tool_result", tool_use_id: id, content: "ok", is_error: isError };
}

function zeroUsage(): Usage {
  return { input: 0, output: 0, cache_read: 0, cache_creation: 0, reasoning: 0 };
}

/**
 * 构造一个含单次 tool_use + tool_result 的 session。
 * toolName 决定是否被判定为非确定（默认白名单内为 'bash'）。
 */
async function buildSession(
  writer: TranscriptWriter,
  opts: {
    toolName?: string;
    toolInput?: unknown;
    resultIsError?: boolean;
  } = {},
): Promise<string> {
  const sessionId = await writer.startSession({ cwd: CWD, gitBranch: GIT, version: VERSION });
  const assistantUuid = await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [toolUseBlock("tu_1", opts.toolName ?? "bash", opts.toolInput ?? { command: "echo hi" })] as unknown as NormalizedContent,
    toolUseId: "tu_1",
    usage: zeroUsage(),
    parentUuid: null,
  });
  await writer.append({
    type: "tool_result",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [toolResultBlock("tu_1", opts.resultIsError ?? false)] as unknown as NormalizedContent,
    toolUseId: "tu_1",
    parentUuid: assistantUuid,
  });
  return sessionId;
}

/** 构造一个损坏 transcript：orphaned tool_result（toolUseId 无配对 assistant 声明）。 */
async function buildCorruptSession(writer: TranscriptWriter): Promise<string> {
  const sessionId = await writer.startSession({ cwd: CWD, gitBranch: GIT, version: VERSION });
  const root = await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: textContent("root"),
    toolUseId: "tu_real",
    usage: zeroUsage(),
    parentUuid: null,
  });
  // 孤儿 tool_result：toolUseId 无 assistant 声明
  await writer.append({
    type: "tool_result",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: textContent("orphan"),
    toolUseId: "tu_orphan_no_pair",
    parentUuid: root,
  });
  return sessionId;
}

/** FakeSandbox：按注入的 exitCode 映射返回结果；setupScript 注入会切到确定性映射。 */
class FakeSandbox implements SandboxHandle {
  calls: string[] = [];
  constructor(
    private readonly exitMap: Map<string, number>,
    private readonly setupExitCode?: number,
  ) {}
  async execute(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.calls.push(command);
    if (this.setupExitCode !== undefined) {
      return { exitCode: this.setupExitCode, stdout: "", stderr: "" };
    }
    const code = this.exitMap.get(command) ?? 0;
    return { exitCode: code, stdout: "", stderr: "" };
  }
}

// ---------------------------------------------------------------------------
// TL-T04
// ---------------------------------------------------------------------------
describe("TL-T04", () => {
  let baseDir: string;
  let writer: TranscriptWriter;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "tl-t04-"));
    writer = createTranscriptWriter({ baseDir });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "replay: 确定性 session exit code 复现"
  //   Given 一个 session 原失败 exit code=1
  //   When  replay(sessionId, {freshSandbox})
  //   Then  返回 replayExitCode，reproduced = (replayExitCode===originalExitCode)
  // -------------------------------------------------------------------------
  it("replay: 确定性 session exit code 复现", async () => {
    const sessionId = await buildSession(writer, {
      toolName: "bash",
      toolInput: { command: "false" },
      resultIsError: true,
    });

    const harness = createReplayHarness({
      transcript: writer,
      deterministicTools: ["bash"],
      getOriginalExitCode: () => 1, // 原失败 exit code=1
    });
    // sandbox 重放该命令也退出 1 → 复现
    const sandbox = new FakeSandbox(new Map([["false", 1]]), undefined) as unknown as SandboxHandle;
    const result = await harness.replay(sessionId, { freshSandbox: sandbox });

    expect(result.sessionId).toBe(sessionId);
    expect(result.originalExitCode).toBe(1);
    expect(result.replayExitCode).toBe(1);
    expect(result.reproduced).toBe(true);
    expect(result.nondeterministicActions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "replay: 非确定 action 列入 nondeterministicActions"
  //   Given session 含网络调用（非确定），无 setupScript
  //   When  replay
  //   Then  nondeterministicActions 列出该 action，reproduced=false（不静默假复现）
  // -------------------------------------------------------------------------
  it("replay: 非确定 action 列入 nondeterministicActions", async () => {
    const sessionId = await buildSession(writer, {
      toolName: "http_get",
      toolInput: { url: "https://example.com" },
    });

    const harness = createReplayHarness({
      transcript: writer,
      deterministicTools: ["bash"], // http_get 不在白名单 → 非确定
      getOriginalExitCode: () => 0,
    });
    const sandbox = new FakeSandbox(new Map(), undefined) as unknown as SandboxHandle;
    const result = await harness.replay(sessionId, { freshSandbox: sandbox });

    // 非确定 action 被列出
    expect(result.nondeterministicActions.length).toBeGreaterThan(0);
    expect(
      result.nondeterministicActions.some((a) => /http_get|network|url/i.test(a)),
    ).toBe(true);
    // 不静默假复现：reproduced=false
    expect(result.reproduced).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "replay: setupScript 注入后确定性恢复"
  //   Given session 含网络调用但提供 setupScript（mock 响应持久化）
  //   When  replay
  //   Then  reproduced 由 exit code 决定（setup 注入确定性）
  // -------------------------------------------------------------------------
  it("replay: setupScript 注入后确定性恢复", async () => {
    const sessionId = await buildSession(writer, {
      toolName: "http_get",
      toolInput: { url: "https://example.com" },
    });

    const harness = createReplayHarness({
      transcript: writer,
      deterministicTools: ["bash"],
      getOriginalExitCode: () => 0, // 原成功 exit 0
    });
    // setupScript 注入后 sandbox 走确定性映射，返回 exit 0 → reproduced=true
    const sandbox = new FakeSandbox(new Map(), 0) as unknown as SandboxHandle;
    const result = await harness.replay(sessionId, {
      freshSandbox: sandbox,
      setupScript: "mock-https-response",
    });

    // setup 注入确定性后，nondeterministicActions 不再阻塞复现判定
    expect(result.replayExitCode).toBe(0);
    expect(result.reproduced).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "replay: transcript 损坏 → TranscriptCorruptError"
  //   Given transcript 损坏（orphaned tool_use_id）
  //   When  replay
  //   Then  抛 TranscriptCorruptError，不尝试部分重放
  // -------------------------------------------------------------------------
  it("replay: transcript 损坏 → TranscriptCorruptError", async () => {
    const sessionId = await buildCorruptSession(writer);
    // 预置：损坏 transcript 的 verifyTree 须检出 orphan
    const nodes = await writer.loadSession(sessionId);
    expect(writer.verifyTree(nodes).ok).toBe(false);

    const harness = createReplayHarness({
      transcript: writer,
      deterministicTools: ["bash"],
      getOriginalExitCode: () => 0,
    });
    const sandbox = new FakeSandbox(new Map(), 0) as unknown as SandboxHandle;
    await expect(
      harness.replay(sessionId, { freshSandbox: sandbox }),
    ).rejects.toThrowError(TranscriptCorruptError);
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "measureReproRate: 6/10 → rate 0.6"
  //   Given 10 个 session，6 个复现
  //   When  measureReproRate
  //   Then  {reproduced:6, total:10, rate:0.6}
  // -------------------------------------------------------------------------
  it("measureReproRate: 6/10 → rate 0.6", async () => {
    // 10 个确定性 session：6 个 sandbox 返回与 original 一致（复现），4 个不一致
    const sessionIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const sid = await buildSession(writer, {
        toolName: "bash",
        toolInput: { command: `cmd-${i}` },
        resultIsError: i < 6, // 前 6 原失败(exit 1)，后 4 原成功(exit 0)
      });
      sessionIds.push(sid);
    }

    // 前 6 session 原 exit 1（复现），后 4 session 原 exit 0；sandboxFactory 按
    // sessionId 序返回：前 6 返回 1（=original 1 复现），后 4 返回 1（≠original 0 不复现）
    const originalBySession = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      originalBySession.set(sessionIds[i]!, i < 6 ? 1 : 0);
    }
    let factoryCounter = 0;
    const harness = createReplayHarness({
      transcript: writer,
      deterministicTools: ["bash"],
      getOriginalExitCode: (sid: string) => originalBySession.get(sid) ?? 0,
      sandboxFactory: () => {
        const idx = factoryCounter++;
        return new FakeSandbox(
          new Map([[`cmd-${idx}`, 1]]),
          undefined,
        ) as unknown as SandboxHandle;
      },
    });

    const rate = await harness.measureReproRate(sessionIds);
    expect(rate.total).toBe(10);
    expect(rate.reproduced).toBe(6);
    expect(rate.rate).toBeCloseTo(0.6, 6);
  });
});
