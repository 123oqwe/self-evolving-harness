// TL-T01: JSONL append-only transcript writer + session loader
//
// 每会话一个 append-only JSONL 文件，每行一个 type 鉴别的事件，
// parentUuid 形成 conversation tree（支持 fork/resume）。
// 落 <baseDir>/projects/<encoded-cwd>/<session-id>.jsonl。
// encoded-cwd：把 `/` 替换 `-`，避免跨平台路径问题。
//
// 复用：CC JSONL transcript 格式（type/parentUuid/uuid 字段约定）。
// 自研：append 强制 parentUuid + append-only 校验、verifyTree orphaned 检测。
//
// static-core：append-only 不变量——已写节点行不可变（仅追加新行）。

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  NormalizedContent,
  TranscriptNode,
} from "./transcript-schema";
import { findOrphans } from "./transcript-schema";

// ---------------------------------------------------------------------------
// 公共接口签名（spec TL-T01 接口签名节，一字不差）
// ---------------------------------------------------------------------------
export interface TranscriptWriter {
  // 仅创建空 JSONL 文件 + 返回 sessionId，不写 root 节点；
  // root 由首条 append({parentUuid:null}) 产生（其 parentUuid=null）
  startSession(ctx: {
    cwd: string;
    gitBranch: string;
    version: string;
  }): Promise<string /*sessionId*/>;
  append(
    node: Omit<TranscriptNode, "uuid" | "parentUuid" | "timestamp"> & {
      parentUuid: string | null;
    },
  ): Promise<string /*uuid*/>;
  appendSubagentBoundary(
    parentUuid: string,
    agentId: string,
  ): Promise<string>;
  loadSession(sessionId: string): Promise<TranscriptNode[]>;
  verifyTree(nodes: TranscriptNode[]): { ok: boolean; orphans: string[] };
  sessionPath(sessionId: string): string; // 返回该 session 的 JSONL 文件绝对路径
}

// 工厂：baseDir 覆盖默认 ~/.<harness>/projects 根，供测试隔离
export function createTranscriptWriter(opts: {
  baseDir: string;
}): TranscriptWriter {
  return new TranscriptWriterImpl(opts.baseDir);
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------
class TranscriptWriterImpl implements TranscriptWriter {
  private readonly baseDir: string;
  // sessionId → session 上下文（cwd/gitBranch/version）
  private readonly sessionCtx = new Map<
    string,
    { cwd: string; gitBranch: string; version: string }
  >();
  // sessionId → JSONL 文件绝对路径
  private readonly sessionFile = new Map<string, string>();
  // uuid → sessionId（供 appendSubagentBoundary 反查 session）
  private readonly uuidToSession = new Map<string, string>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  // encoded-cwd：把 `/` 替换 `-`
  private encodeCwd(cwd: string): string {
    return cwd.replace(/\//g, "-");
  }

  private resolveSessionFile(sessionId: string): string | null {
    const cached = this.sessionFile.get(sessionId);
    if (cached) return cached;
    // 重水化场景（新 writer 实例）：在 baseDir 下递归找 <sessionId>.jsonl
    const projectsDir = join(this.baseDir, "projects");
    if (!existsSync(projectsDir)) return null;
    for (const entry of readdirSync(projectsDir)) {
      const candidate = join(projectsDir, entry, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  sessionPath(sessionId: string): string {
    const resolved = this.resolveSessionFile(sessionId);
    if (!resolved) {
      throw new Error(`no session file found for sessionId=${sessionId}`);
    }
    return resolved;
  }

  async startSession(ctx: {
    cwd: string;
    gitBranch: string;
    version: string;
  }): Promise<string> {
    const sessionId = randomUUID();
    const encodedCwd = this.encodeCwd(ctx.cwd);
    const dir = join(this.baseDir, "projects", encodedCwd);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${sessionId}.jsonl`);
    // 创建空 JSONL 文件（不写 root 节点；root 由首条 append 产生）
    writeFileSync(filePath, "", { flag: "wx" });
    this.sessionCtx.set(sessionId, {
      cwd: ctx.cwd,
      gitBranch: ctx.gitBranch,
      version: ctx.version,
    });
    this.sessionFile.set(sessionId, filePath);
    return sessionId;
  }

  async append(
    node: Omit<TranscriptNode, "uuid" | "parentUuid" | "timestamp"> & {
      parentUuid: string | null;
    },
  ): Promise<string> {
    const filePath = this.requireSessionFile(node.sessionId);
    const uuid = randomUUID();
    const timestamp = new Date().toISOString();
    const full: TranscriptNode = {
      ...node,
      uuid,
      parentUuid: node.parentUuid,
      timestamp,
    };
    appendFileSync(filePath, `${JSON.stringify(full)}\n`, "utf8");
    this.sessionFile.set(node.sessionId, filePath);
    this.uuidToSession.set(uuid, node.sessionId);
    return uuid;
  }

  async appendSubagentBoundary(
    parentUuid: string,
    agentId: string,
  ): Promise<string> {
    const sessionId = this.uuidToSession.get(parentUuid);
    if (!sessionId) {
      throw new Error(
        `appendSubagentBoundary: parentUuid=${parentUuid} not found in this writer's known nodes`,
      );
    }
    const ctx = this.sessionCtx.get(sessionId);
    if (!ctx) {
      throw new Error(
        `appendSubagentBoundary: missing session ctx for sessionId=${sessionId}`,
      );
    }
    const filePath = this.requireSessionFile(sessionId);
    const uuid = randomUUID();
    const timestamp = new Date().toISOString();
    const node: TranscriptNode = {
      uuid,
      parentUuid,
      type: "subagent_boundary",
      sessionId,
      cwd: ctx.cwd,
      gitBranch: ctx.gitBranch,
      version: ctx.version,
      timestamp,
      agentId,
      content: [] as NormalizedContent,
    };
    appendFileSync(filePath, `${JSON.stringify(node)}\n`, "utf8");
    this.uuidToSession.set(uuid, sessionId);
    return uuid;
  }

  async loadSession(sessionId: string): Promise<TranscriptNode[]> {
    const filePath = this.resolveSessionFile(sessionId);
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`loadSession: no JSONL file for sessionId=${sessionId}`);
    }
    const raw = readFileSync(filePath, "utf8");
    if (raw.length === 0) return [];
    const lines = raw.split("\n");
    const nodes: TranscriptNode[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      const parsed = JSON.parse(line) as TranscriptNode;
      nodes.push(parsed);
    }
    return nodes;
  }

  verifyTree(nodes: TranscriptNode[]): { ok: boolean; orphans: string[] } {
    return findOrphans(nodes);
  }

  private requireSessionFile(sessionId: string): string {
    const filePath = this.resolveSessionFile(sessionId);
    if (!filePath) {
      throw new Error(
        `transcript: no session file for sessionId=${sessionId}; call startSession first`,
      );
    }
    return filePath;
  }
}
