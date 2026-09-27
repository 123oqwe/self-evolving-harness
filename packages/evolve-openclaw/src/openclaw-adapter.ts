// PLG-T05: OpenClawAdapter — HarnessPort 落到 OpenClaw (openclaw.ai) harness。
//
// Spec: execution/plugin/TASKS.md §PLG-T05 (openclaw-adapter.ts).
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError/UnknownStagingError
//    复用 @harness/adapters port.ts（不重造契约）
//  - Trajectory/LLMPort/bumpVersion 从 @harness/l3-engine 导入
//  - SQLite + archived JSONL 双源→Trajectory 映射复用 trajectory.ts
//    （不复用 ADP-T01 extractDiagnosis——OpenClaw transcript 表字段名私有，
//     与 TL-T01 不同构）
//  - L1-T01 git checkout 回滚语义 / L3-T08 bumpVersion 复用
//  - LLM 透传外部注入的 LLMPort（OpenClaw 无独立 headless CLI 调用契约）
//
// 自研边界（§0.2）：仅 (a) 基质 id→磁盘路径映射、(b) OpenClaw 私有轨迹格式→
// L3 Trajectory 解析、(c) deploy 写回 repoRoot 镜像 + git、(d) LLM port 透传。
// 不实现 generate/score/select/retain/archive/canary 任何进化逻辑。

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

import { readOpenClawTrajectories } from "./trajectory.js";
import {
  mapOpenClawSubstratePath,
  makeOpenClawSubstrateHandle,
  openclawSubstrateBasename,
} from "./substrate.js";

/** OpenClawAdapter 选项。 */
export interface OpenClawAdapterOptions {
  /** workspace 目录（活跃基质源），默认 process.env.OPENCLAW_WORKSPACE_DIR ?? ~/.openclaw/workspace。 */
  readonly workspaceDir: string;
  /** state 目录（轨迹源 agents/<id>/agent/ + sessions/），默认 ~/.openclaw。 */
  readonly stateDir: string;
  /** 轨迹归属的 agent id。 */
  readonly agentId: string;
  /** workspace skills git 版本化镜像目录。 */
  readonly repoRoot: string;
  /** LLM 由外部注入（透传）。 */
  readonly llmPort: LLMPort;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * OpenClaw harness 适配器：基质=workspace skills/<name>/SKILL.md +
 * {AGENTS,SOUL,USER,IDENTITY,BOOT,BOOTSTRAP,MEMORY}.md；轨迹=每 agent SQLite
 * `agents/<id>/agent/openclaw-agent.sqlite` + archived JSONL
 * `agents/<id>/sessions/*.jsonl`；deploy=repoRoot 镜像 git commit + hybrid reload
 * 提示；LLM=透传外部注入。
 *
 * hybrid reload（调研）：skills watcher 在下一 agent turn 拾取变更，无需重启
 * Gateway——deploy 仅提示，不调 `openclaw gateway restart`（那是 reload=off 才需要）。
 */
export class OpenClawAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly agentId: string;
  private readonly repoRoot: string;
  private readonly staging: Map<string, StagingEntry> = new Map();
  /** 最近一次部署的基质 repoRel（rollback 用来定位 checkout 目标）。 */
  private lastDeployedRepoRel: string | undefined;

  constructor(opts: OpenClawAdapterOptions) {
    this.workspaceDir = opts.workspaceDir;
    this.stateDir = opts.stateDir;
    this.agentId = opts.agentId;
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapOpenClawSubstratePath(id);
    const abs = join(this.workspaceDir, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeOpenClawSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapOpenClawSubstratePath(id);
    const handle = makeOpenClawSubstrateHandle(id, content);
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
    return readOpenClawTrajectories(this.stateDir, this.agentId, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active 镜像（git 版本化目录：skills/<n>/SKILL.md / AGENTS.md ...）。
    const abs = join(this.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(openclawSubstrateBasename(entry.id));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
    this.lastDeployedRepoRel = entry.repoRel;
    // 同步 repoRoot active → workspaceDir/skills/（hybrid reload：skills watcher
    // 在下一 agent turn 拾取，无需重启 Gateway）。镜像 PLG-T04 syncToHermesHome。
    this.syncToWorkspaceDir(entry.repoRel, entry.content);
    // hybrid reload 提示（调研：skills watcher 下一 agent turn 拾取，无需重启）。
    process.stdout.write(
      "[openclaw] hybrid reload: skill watcher picks up on next agent turn\n",
    );
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    // 取最后部署的基质 repoRel，git checkout 到 rollbackTo 版本（L1-T01 语义），
    // 再同步回滚后的 active 内容到 workspaceDir（镜像 PLG-T04 rollback）。
    const repoRel = this.lastDeployedRepoRel;
    if (!repoRel) return;
    execSync(
      `git checkout ${rollbackTo} -- ${JSON.stringify(repoRel)}`,
      { cwd: this.repoRoot, stdio: ["ignore", "ignore", "ignore"] },
    );
    const abs = join(this.repoRoot, repoRel);
    if (existsSync(abs)) {
      this.syncToWorkspaceDir(repoRel, readFileSync(abs, "utf8"));
    }
  }

  /**
   * 把 repoRoot active 内容同步到 workspaceDir（活跃基质源，OpenClaw 实际读取处）。
   * workspaceDir 不可写 / 不存在 → 容错跳过（git 镜像已落，不阻塞 deploy）。
   */
  private syncToWorkspaceDir(repoRel: string, content: string): void {
    try {
      const abs = join(this.workspaceDir, repoRel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    } catch {
      // workspaceDir 不可写 / 不存在 → 容错跳过（git 镜像已落，不阻塞 deploy）
    }
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
 * 工厂：返回一个 OpenClaw HarnessPort（CLI registry 共用形态）。
 * 对齐 spec §PLG-T05 `createOpenClawPlugin(opts): HarnessPort`。
 */
export function createOpenClawPlugin(opts: OpenClawAdapterOptions): HarnessPort {
  return new OpenClawAdapter(opts);
}
