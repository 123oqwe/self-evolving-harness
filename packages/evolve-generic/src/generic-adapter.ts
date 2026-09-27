// PLG-T07: evolve-generic — YAML 声明式通用适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T07 (generic-adapter.ts)。
// 复用铁律（§0.2）：本类只做 6 方法映射（基质路径 / 轨迹解析 / 部署写回），
// implements HarnessPort（@harness/adapters）；进化逻辑全部复用 evolve-core。
// 禁止在本包内实现 generate/score/select/retain/archive/canary。

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  HarnessPort,
  SubstrateHandle,
  DeployResult,
} from "@harness/adapters";
import {
  SubstrateNotFoundError,
  UnknownStagingError,
  contentSha,
  inferKind,
} from "@harness/adapters";
import type { Trajectory, LLMPort } from "@harness/l3-engine";
import { bumpVersion } from "@harness/l3-engine";

import type { GenericAdapterConfig } from "./config.js";
import { loadGenericConfig } from "./config.js";
import { parseTrajectories } from "./parsers.js";

export interface GenericAdapterOptions {
  readonly config: GenericAdapterConfig;
  readonly llmPort: LLMPort;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * 由 GenericAdapterConfig 驱动的 HarnessPort 实现。
 * 基质 id 形如 `<idPrefix><pathMapKey>`；pathMap 将 key 映射到磁盘相对路径。
 */
export class GenericAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly cfg: GenericAdapterConfig;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: GenericAdapterOptions) {
    this.cfg = opts.config;
    this.llmPort = opts.llmPort;
  }

  /** id → pathMap key（剥 idPrefix）。 */
  private mapSubstratePath(id: string): { key: string; diskRel: string } {
    const prefix = this.cfg.substrate.idPrefix;
    let key = id;
    if (prefix && id.startsWith(prefix)) {
      key = id.slice(prefix.length);
    }
    const diskRel = this.cfg.substrate.pathMap[key] ?? key;
    return { key, diskRel };
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const { diskRel } = this.mapSubstratePath(id);
    const abs = join(this.cfg.substrate.diskRoot, diskRel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha: contentSha(content),
    }) as SubstrateHandle;
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const { diskRel } = this.mapSubstratePath(id);
    const sha = contentSha(content);
    // 落 repoRoot staging（active 不直接覆盖；deploy 时同步到 diskRoot/syncTarget）。
    const stagingDir = join(this.cfg.substrate.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, diskRel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: diskRel, content, sha });
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha,
    }) as SubstrateHandle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return parseTrajectories(this.cfg.trajectory, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active（git 版本化镜像目录）。
    const abs = join(this.cfg.substrate.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.cfg.substrate.repoRoot,
    });
    const version = bumpVersion(entry.repoRel);
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.cfg.substrate.repoRoot },
    );
    const newHead = this.gitHead();
    // 同步到 syncTarget（活跃基质目录，可选）。
    if (this.cfg.deploy.syncTarget) {
      try {
        const syncAbs = join(this.cfg.deploy.syncTarget, entry.repoRel);
        mkdirSync(join(syncAbs, ".."), { recursive: true });
        writeFileSync(syncAbs, entry.content, "utf8");
      } catch {
        // syncTarget 不可写不阻塞 deploy（git 已落）。
      }
    }
    // 重启提示（不自动 kill 进程）。直接写 process.stdout 以便测试可截获。
    // eslint-disable-next-line no-console
    process.stdout.write(`${this.cfg.deploy.restartHint}\n`);
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    let entry: StagingEntry | undefined;
    for (const e of this.staging.values()) entry = e;
    if (!entry) return;
    execSync(`git checkout ${rollbackTo} -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.cfg.substrate.repoRoot,
    });
    if (this.cfg.deploy.syncTarget) {
      try {
        const restored = readFileSync(
          join(this.cfg.substrate.repoRoot, entry.repoRel),
          "utf8",
        );
        const syncAbs = join(this.cfg.deploy.syncTarget, entry.repoRel);
        mkdirSync(join(syncAbs, ".."), { recursive: true });
        writeFileSync(syncAbs, restored, "utf8");
      } catch {
        /* ignore */
      }
    }
  }

  private gitHead(): string {
    return execSync("git rev-parse HEAD", {
      cwd: this.cfg.substrate.repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  }
}

/**
 * 从 YAML 路径构造 GenericAdapter（HarnessPort）。
 * verified:false 配置不阻断构造（仅文档标注）。
 */
export function createGenericPlugin(yamlPath: string, llmPort: LLMPort): HarnessPort {
  const config = loadGenericConfig(yamlPath);
  return new GenericAdapter({ config, llmPort });
}
