// PLG-T11: DshAdapter — DeepSeek Harness HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T11。
//
// 复用铁律（§0.2）：本包只做 4 方法映射（基质/轨迹/部署/LLM），不重造进化逻辑。
//   - readSubstrate/writeSubstrate：复用 @harness/adapters contentSha/inferKind/SubstrateNotFoundError
//   - readTrajectories：复用 extractDiagnosis（TL-T01 同构）+ 私有字段兜底
//   - deploy/rollback：镜像 ReferenceAdapter（git commit/checkout + 同步 profile 目录）
//   - llmPort：透传外部注入（dsh 无独立 headless CLI 契约）

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

import type { HarnessPort, SubstrateHandle, DeployResult } from "@harness/adapters";
import {
  contentSha,
  inferKind,
  SubstrateNotFoundError,
  UnknownStagingError,
} from "@harness/adapters";
import type { Trajectory, LLMPort } from "@harness/l3-engine";
import { bumpVersion } from "@harness/l3-engine";

import { mapDshSubstratePath } from "./substrate.js";
import { readDshTrajectories } from "./trajectory.js";
import { syncProfileToDshHome, reverseSyncProfile } from "./profile.js";

export interface DshAdapterOptions {
  /** 默认 process.env.DSH_HOME ?? ~/.dsh。 */
  readonly dshHome: string;
  /** profile 名（cordis.patch.yml 叠加层归属，如 'default'）。 */
  readonly profile: string;
  /** AGENTS.md git 版本化目录。 */
  readonly repoRoot: string;
  /** 透传外部注入（dsh 无原生 headless CLI）。 */
  readonly llmPort: LLMPort;
}

interface DshStagingEntry {
  readonly id: string;
  readonly content: string;
  readonly sha: string;
  readonly repoRelPath: string;
  readonly isProfile: boolean;
  readonly profileSyncPath: string | null;
}

const RESTART_HINT = "[dsh] restart dsh / open new session to load new substrate";

export class DshAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly dshHome: string;
  private readonly profile: string;
  private readonly repoRoot: string;
  private readonly staging: Map<string, DshStagingEntry> = new Map();
  private readonly deployedPaths: { repoRelPath: string; profileSyncPath: string | null }[] = [];

  constructor(opts: DshAdapterOptions) {
    this.dshHome = opts.dshHome;
    this.profile = opts.profile;
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const mapping = mapDshSubstratePath(id, this.repoRoot, this.dshHome);
    if (mapping === null || !existsSync(mapping.readPath)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(mapping.readPath, "utf8");
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha: contentSha(content),
    }) as SubstrateHandle;
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const mapping = mapDshSubstratePath(id, this.repoRoot, this.dshHome);
    if (mapping === null) {
      throw new SubstrateNotFoundError(id);
    }
    const sha = contentSha(content);
    // 落 repoRoot staging（不直接覆盖 active）
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, basename(id) || "substrate");
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, {
      id,
      content,
      sha,
      repoRelPath: mapping.repoRelPath,
      isProfile: mapping.isProfile,
      profileSyncPath: mapping.profileSyncPath,
    });
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha,
    }) as SubstrateHandle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return readDshTrajectories(this.dshHome, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 active 文件到 repoRoot 镜像
    const abs = join(this.repoRoot, entry.repoRelPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    // git add + commit（真走 git）
    execSync(`git add -- ${JSON.stringify(entry.repoRelPath)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(basename(entry.id));
    execSync(`git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`, {
      cwd: this.repoRoot,
    });
    // profile patch 同步到 dshHome（若适用）
    if (entry.isProfile && entry.profileSyncPath) {
      syncProfileToDshHome(abs, entry.profileSyncPath);
    }
    // 记录已部署路径（rollback 用）
    this.deployedPaths.push({
      repoRelPath: entry.repoRelPath,
      profileSyncPath: entry.profileSyncPath,
    });
    const newHead = this.gitHead();
    // 打印重启提示（不自动 kill）
    process.stdout.write(RESTART_HINT + "\n");
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    // checkout 所有已部署的 repoRoot 镜像路径到 rollbackTo
    const targets = this.deployedPaths.length > 0
      ? this.deployedPaths
      : [];
    for (const t of targets) {
      execSync(`git checkout ${rollbackTo} -- ${JSON.stringify(t.repoRelPath)}`, {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
      // 反向同步 profile patch（若适用）
      if (t.profileSyncPath) {
        const mirrorAbs = join(this.repoRoot, t.repoRelPath);
        reverseSyncProfile(mirrorAbs, t.profileSyncPath);
      }
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
 * 默认 dshHome 解析：process.env.DSH_HOME ?? ~/.dsh。
 */
export function defaultDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** 插件工厂：返回一个装配好的 HarnessPort（CLI registry 共用）。 */
export function createDshPlugin(opts: DshAdapterOptions): HarnessPort {
  return new DshAdapter(opts);
}
