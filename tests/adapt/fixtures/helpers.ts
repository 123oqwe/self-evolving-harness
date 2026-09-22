// adapt 模块测试共享 fixture 与辅助函数。
//
// 仅依赖 @harness/l3-engine 的 type-only import（transpile 时擦除，RED 态不阻塞），
// 以及 node 内建 fs/os/path/child_process。构造 temp git repo / TL-T01 JSONL /
// Claude Code JSONL 等最小合法 fixture，供 ADP-T01/T02/T03 复用。

import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { LLMPort } from "@harness/l3-engine";

// ---------------------------------------------------------------------------
// FakeLLM（adapt 本地版，与 tests/L3/fixtures/fake-llm 同构，避免跨目录耦合）
// ---------------------------------------------------------------------------

export class FakeLLM implements LLMPort {
  public readonly calls: string[] = [];
  private readonly reply: string;
  constructor(reply = "FAKE-LLM-REPLY") {
    this.reply = reply;
  }
  async complete(_prompt: string): Promise<string> {
    this.calls.push(_prompt);
    return this.reply;
  }
}

// ---------------------------------------------------------------------------
// temp git repo fixture（ADP-T01 reference-adapter / ADP-T02 / ADP-T03 复用）
// ---------------------------------------------------------------------------

export interface GitRepo {
  root: string;
  /** 在 repo 内写一个文件并 git add（不 commit）。返回相对路径。 */
  writeFile(relPath: string, content: string): string;
  /** git add + commit 当前暂存，返回 commit sha。 */
  commit(message?: string): string;
  /** 读取某文件当前内容。 */
  read(relPath: string): string;
  /** 计算某文件 sha256（用于断言 active 未被覆盖）。 */
  sha256(relPath: string): string;
  /** git rev-parse HEAD。 */
  head(): string;
  /** 销毁 temp repo。 */
  destroy(): void;
}

export function makeGitRepo(): GitRepo {
  const root = mkdtempSync(join(tmpdir(), "adapt-repo-"));
  // git init + 设 user（避免 CI 无 user 报错）
  execSync("git init -q", { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  execSync('git config user.name "test"', { cwd: root });
  execSync("git config commit.gpgsign false", { cwd: root });

  return {
    root,
    writeFile(relPath, content) {
      const abs = join(root, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
      execSync(`git add -- ${JSON.stringify(relPath)}`, { cwd: root });
      return relPath;
    },
    commit(message = "wip") {
      execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: root });
      return execSync("git rev-parse HEAD", { cwd: root })
        .toString()
        .trim();
    },
    read(relPath) {
      return readFileSync(join(root, relPath), "utf8");
    },
    sha256(relPath) {
      return createHash("sha256")
        .update(readFileSync(join(root, relPath)))
        .digest("hex");
    },
    head() {
      return execSync("git rev-parse HEAD", { cwd: root })
        .toString()
        .trim();
    },
    destroy() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// TL-T01 形状 TranscriptNode fixture（ADP-T02 轨迹源解析）
// 字段对齐 tests/TL/T01-transcript.spec.ts：uuid/parentUuid/type/sessionId/cwd/
// gitBranch/version/timestamp/agentId?/content/toolUseId?/usage?
// ---------------------------------------------------------------------------

export interface TlTranscriptNode {
  uuid: string;
  parentUuid: string | null;
  type: "user" | "assistant";
  sessionId: string;
  cwd: string;
  gitBranch: string;
  version: string;
  timestamp: string;
  agentId?: string;
  content: unknown;
  toolUseId?: string;
  usage?: unknown;
}

export function writeTlJsonl(
  dir: string,
  sessionId: string,
  nodes: TlTranscriptNode[],
): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(
    file,
    nodes.map((n) => JSON.stringify(n)).join("\n") + "\n",
    "utf8",
  );
  return file;
}

/** 构造一条含 user 失败 + assistant 报错的 TL-T01 session（用于轨迹解析）。 */
export function makeFailedTlSession(sessionId: string): TlTranscriptNode[] {
  return [
    {
      uuid: "u1",
      parentUuid: null,
      type: "user",
      sessionId,
      cwd: "/repo",
      gitBranch: "main",
      version: "0.1.0",
      timestamp: "2025-01-01T00:00:00Z",
      content: [{ type: "text", text: "run compaction" }],
    },
    {
      uuid: "u2",
      parentUuid: "u1",
      type: "assistant",
      sessionId,
      cwd: "/repo",
      gitBranch: "main",
      version: "0.1.0",
      timestamp: "2025-01-01T00:00:01Z",
      content: [
        {
          type: "tool_result",
          toolUseId: "tu1",
          is_error: true,
          content: "Error: compaction summary truncated",
        },
      ],
      toolUseId: "tu1",
    },
  ];
}

// ---------------------------------------------------------------------------
// Claude Code JSONL 事件流 fixture（ADP-T03 轨迹源解析）
// 字段参照 research 记录：type/parentUuid/sessionId/cwd/message/toolUseId/timestamp
// ---------------------------------------------------------------------------

export interface ClaudeEvent {
  type: string;
  parentUuid: string | null;
  sessionId: string;
  cwd: string;
  message: unknown;
  toolUseId?: string;
  timestamp: string;
}

export function writeClaudeJsonl(
  dir: string,
  sessionId: string,
  events: ClaudeEvent[],
): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(
    file,
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
  return file;
}

/** 构造一条含 error tool_result 的 Claude Code 失败 session。 */
export function makeFailedClaudeSession(sessionId: string): ClaudeEvent[] {
  return [
    {
      type: "user",
      parentUuid: null,
      sessionId,
      cwd: "/repo",
      message: { content: "run evolve" },
      timestamp: "2025-01-01T00:00:00Z",
    },
    {
      type: "assistant",
      parentUuid: "u1",
      sessionId,
      cwd: "/repo",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu1",
            is_error: true,
            content: "Error: substrate mutation rejected",
          },
        ],
      },
      toolUseId: "tu1",
      timestamp: "2025-01-01T00:00:01Z",
    },
  ];
}

// ---------------------------------------------------------------------------
// pi CLI 可达性探测（ADP-T02 / REAL-T01 smoke 门控）
// ---------------------------------------------------------------------------

/** 创建一个空 temp piHome 目录（模拟 ~/.pi/agent），返回路径。 */
export function mkdtempPiHome(): string {
  return mkdtempSync(join(tmpdir(), "adapt-pihome-"));
}

// ---------------------------------------------------------------------------
// Fake pi 二进制（ADP-T02 PiHeadlessLLM 真子进程测试）
// ---------------------------------------------------------------------------
// 背景：vitest 的 vi.mock / vi.doMock / vi.spyOn 对 `node:child_process` 内建
// 模块均不生效——built-in 导出冻结（`Cannot redefine property: spawn`）且
// built-in 不经 vitest 的模块 loader，故 mock factory 永不装配。spec §ADP-T02
// RED 写的 "vi.mock child_process" 技术路线在本仓库 vitest 配置下不可用。
// 改用"真实 fake pi 二进制"端到端验证：生成带 shebang 的 temp .mjs，由
// PiHeadlessLLM 的 spawn 真实 execve 执行，记录 argv / spawn 计数 / SIGTERM
// marker，覆盖 spec 的 argv 断言、重试计数、超时-kill 三个场景。比 mock 更
// 真实地覆盖子进程语义（与 tests/L0S/T06 真子进程测试同构）。

export interface FakePiBinOptions {
  /** 成功时写入 stdout 的内容（默认 "MUTANT_JSON"）。 */
  readonly stdout?: string;
  /** 写入 stderr 的内容（默认 ""）。 */
  readonly stderr?: string;
  /** 退出码（默认 0）。hang=true 时忽略。 */
  readonly exitCode?: number;
  /** 挂死模式：忽略 exitCode，setInterval 挂住；收到 SIGTERM 写 marker 后 exit。 */
  readonly hang?: boolean;
}

export interface FakePiBin {
  /** 传给 PiHeadlessLLM 的 piBin 路径（可执行 .mjs）。 */
  readonly path: string;
  /** 每次 spawn 追加 "1\n" 的计数文件路径（断言 spawn 次数）。 */
  readonly counterFile: string;
  /** 成功 spawn 写入 JSON.stringify(process.argv.slice(2)) 的文件路径。 */
  readonly argvFile: string;
  /** hang 模式收到 SIGTERM 时写入的 marker 文件路径。 */
  readonly markerFile: string;
  /** 读取 spawn 计数（已启动的 fake pi 进程数）。 */
  spawnCount(): number;
  /** 读取最后一次 spawn 的 argv（string[]）。 */
  readArgv(): string[];
  /** marker 是否被写入（SIGTERM 是否送达）。 */
  markerWritten(): boolean;
  /** 销毁 temp 目录。 */
  destroy(): void;
}

export function makeFakePiBin(opts: FakePiBinOptions = {}): FakePiBin {
  const dir = mkdtempSync(join(tmpdir(), "adapt-fakepi-"));
  const path = join(dir, "pi-fake.mjs");
  const counterFile = join(dir, "counter.txt");
  const argvFile = join(dir, "argv.json");
  const markerFile = join(dir, "marker.txt");
  // 用 JSON 嵌入配置（JSON 是合法 JS 字面量，路径/字符串无需手动转义）
  const cfg = JSON.stringify({
    counterFile,
    argvFile,
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
if (cfg.hang) {
  process.on("SIGTERM", () => {
    try { writeFileSync(cfg.markerFile, "killed"); } catch {}
    process.exit(0);
  });
  setInterval(() => {}, 60000);
} else {
  if (cfg.stderr) process.stderr.write(cfg.stderr);
  process.stdout.write(cfg.stdout);
  process.exitCode = cfg.exitCode;
}
`;
  writeFileSync(path, script, "utf8");
  chmodSync(path, 0o755);
  return {
    path,
    counterFile,
    argvFile,
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
    markerWritten() {
      return existsSync(markerFile);
    },
    destroy() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function hasPiCli(): boolean {
  try {
    const code = execSync("command -v pi >/dev/null 2>&1; echo $?", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return code === "0";
  } catch {
    return false;
  }
}
