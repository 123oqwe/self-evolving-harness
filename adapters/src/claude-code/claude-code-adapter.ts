// ADP-T03: ClaudeCodeAdapter — HarnessPort 落到 Claude Code harness。
//
// Spec: execution/adapt/TASKS.md §ADP-T03 (claude-code-adapter.ts).
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError 复用 ADP-T01 port.ts
//  - Trajectory/LLMPort 从 @harness/l3-engine 导入
//  - Claude Code JSONL→Trajectory 映射复用 trajectory.ts（不复用 pi 的
//    extractDiagnosis——Claude Code `message.content` 嵌套一层，字段名私有）
//  - L1-T01 git checkout 回滚语义 / L3-T08 bumpVersion 复用
//  - LLM 透传外部注入的 LLMPort（Claude Code 无独立 headless CLI 调用契约，
//    不在 adapter 里 spawn claude——spec 执行提示 (1)）

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  HarnessPort,
  SubstrateHandle,
  DeployResult,
} from "../port.js";
import { SubstrateNotFoundError, UnknownStagingError } from "../port.js";
import { bumpVersion } from "@harness/l3-engine";
import type { Trajectory, LLMPort } from "@harness/l3-engine";

import { readClaudeTrajectories } from "./trajectory.js";
import {
  mapSubstratePath,
  makeSubstrateHandle,
  substrateBasename,
} from "./substrate.js";

/** ClaudeCodeAdapter 选项。 */
export interface ClaudeCodeAdapterOptions {
  /** Claude home 目录（轨迹源 ~/.claude），默认 ~/.claude。 */
  readonly claudeHome: string;
  /** CLAUDE.md / SKILL.md / hooks policy 的 git 版本化目录（如本 repo）。 */
  readonly repoRoot: string;
  /**
   * LLM 由外部注入（Claude Code 无独立 headless CLI 调用契约，复用
   * RealLLMPort via pi 或其他）。adapter 不自己 spawn。
   */
  readonly llmPort: LLMPort;
  /**
   * 轨迹目录覆盖（默认 <claudeHome>/projects/<encoded-repo-root>）。
   * Claude Code 把 cwd 路径的 `/` 替换为 `-` 编码为目录名；测试可注入。
   */
  readonly trajectoryBaseDir?: string;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * Claude Code harness 适配器：基质=CLAUDE.md + .claude/skills/<name>/SKILL.md
 * + hooks policy；轨迹=~/.claude/projects/<encoded-cwd>/<sid>.jsonl；
 * 考卷锁定=PreToolUse hook 拒改测试文件（见 exam-lock.ts）；
 * LLM=透传外部注入的 LLMPort。
 */
export class ClaudeCodeAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly claudeHome: string;
  private readonly repoRoot: string;
  private readonly trajectoryBaseDir: string;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: ClaudeCodeAdapterOptions) {
    this.claudeHome = opts.claudeHome;
    this.repoRoot = opts.repoRoot;
    // 默认 <claudeHome>/projects/<encoded-repoRoot>——Claude Code 把 cwd 的
    // `/` 替换为 `-` 编码。exactOptionalPropertyTypes：仅在传入时赋值。
    this.trajectoryBaseDir =
      opts.trajectoryBaseDir ??
      join(opts.claudeHome, "projects", encodeCwd(opts.repoRoot));
    this.llmPort = opts.llmPort;
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapSubstratePath(id);
    const abs = join(this.repoRoot, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapSubstratePath(id);
    const handle = makeSubstrateHandle(id, content);
    const sha = handle.sha;
    // 落 repoRoot staging（active 未被直接覆盖；deploy 时再写 active）。
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: rel, content, sha });
    return handle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return readClaudeTrajectories(this.trajectoryBaseDir, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active（git 版本化目录：CLAUDE.md / SKILL.md）。
    const abs = join(this.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(substrateBasename(entry.id));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
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
 * Claude Code cwd 编码：把 cwd 路径的 `/` 替换为 `-`（research 记录）。
 * 如 `/repo` → `-repo`，`/Users/foo/bar` → `-Users-foo-bar`。
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}
