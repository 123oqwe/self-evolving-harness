// PLG-T02: CodexAdapter — HarnessPort 落到 OpenAI Codex CLI。
//
// Spec: execution/plugin/TASKS.md §PLG-T02 (codex-adapter.ts)。
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError/UnknownStagingError
//    复用 @harness/adapters port.ts
//  - Trajectory/LLMPort/bumpVersion 从 @harness/l3-engine 导入
//  - 基质 sha / kind 推断 复用 contentSha/inferKind（经 substrate.ts）
//  - 调研为准（§0.6）：基质=AGENTS.md（项目级 repoRoot git 版本化），
//    轨迹=CODEX_HOME/sessions + archived_sessions 下 rollout-*.jsonl，
//    LLM=透传外部注入（Codex 无原生 headless CLI），热加载=无（重启生效）。
// 自研边界：只做 (a) 基质 id→磁盘路径映射、(b) rollout JSONL→Trajectory[] 解析、
// (c) deploy 写回 repoRoot + 提示重启、(d) LLM 透传。不重造进化逻辑。

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  HarnessPort,
  SubstrateHandle,
  DeployResult,
} from "@harness/adapters";
import { SubstrateNotFoundError, UnknownStagingError } from "@harness/adapters";
import { bumpVersion } from "@harness/l3-engine";
import type { Trajectory, LLMPort } from "@harness/l3-engine";

import {
  mapCodexSubstratePath,
  makeCodexSubstrateHandle,
  codexSubstrateBasename,
} from "./substrate.js";
import { readCodexTrajectories } from "./trajectory.js";

/** CodexAdapter 选项。 */
export interface CodexAdapterOptions {
  /** CODEX_HOME（轨迹源），默认 process.env.CODEX_HOME ?? ~/.codex。 */
  readonly codexHome: string;
  /** 项目级 AGENTS.md git 版本化目录。 */
  readonly repoRoot: string;
  /** 透传外部注入的 LLMPort（Codex 无原生 headless CLI）。 */
  readonly llmPort: LLMPort;
  /** sessions 子目录名（调研 SESSIONS_SUBDIR），默认 'sessions'。 */
  readonly sessionsSubdir?: string;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * Codex CLI 适配器：基质=<repoRoot>/AGENTS.md（项目级指令链入口），
 * 轨迹=CODEX_HOME/{sessions,archived_sessions}/rollout-*.jsonl，
 * LLM=透传外部注入，部署=git 版本化 repoRoot + 提示重启 Codex（无热加载）。
 */
export class CodexAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly codexHome: string;
  private readonly repoRoot: string;
  private readonly sessionsSubdir: string;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: CodexAdapterOptions) {
    this.codexHome = opts.codexHome;
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
    this.sessionsSubdir = opts.sessionsSubdir ?? "sessions";
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapCodexSubstratePath(id);
    const abs = join(this.repoRoot, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeCodexSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapCodexSubstratePath(id);
    const handle = makeCodexSubstrateHandle(id, content);
    const sha = handle.sha;
    // 落 repoRoot staging（active AGENTS.md 不直接覆盖；deploy 时同步）。
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: rel, content, sha });
    return handle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    // 扫 sessions/ 与 archived_sessions/ 两目录（archived 不漏）。
    const sessionsDir = join(this.codexHome, this.sessionsSubdir);
    const archivedDir = join(this.codexHome, "archived_sessions");
    const a = readCodexTrajectories(sessionsDir, substrateSha);
    const b = readCodexTrajectories(archivedDir, substrateSha);
    return [...a, ...b];
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active（git 版本化镜像目录）。
    const abs = join(this.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(codexSubstrateBasename(entry.id));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
    // 提示重启 Codex / 开新 session 以加载新 AGENTS.md（不自动 kill 进程）。
    // 经 process.stdout.write 直接写（console.log 在 vitest 下被劫持，测试用
    // captureStdout patch process.stdout.write 捕获）。
    process.stdout.write(
      "[codex] restart codex / open new session to load new AGENTS.md\n",
    );
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    // 取最后部署的基质 repoRel，git checkout 到 rollbackTo 版本。
    let entry: StagingEntry | undefined;
    for (const e of this.staging.values()) entry = e;
    if (!entry) return;
    execSync(
      `git checkout ${rollbackTo} -- ${JSON.stringify(entry.repoRel)}`,
      { cwd: this.repoRoot },
    );
  }

  private gitHead(): string {
    return execSync("git rev-parse HEAD", {
      cwd: this.repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  }
}

/**
 * 插件工厂：harness id → HarnessPort（CLI registry 共用形态）。
 */
export function createCodexPlugin(opts: CodexAdapterOptions): HarnessPort {
  return new CodexAdapter(opts);
}
