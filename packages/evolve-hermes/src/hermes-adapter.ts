// PLG-T04: evolve-hermes · HermesAdapter implements HarnessPort。
//
// Spec: execution/plugin/TASKS.md §PLG-T04。复用铁律（§0.2）：evolve 逻辑只在
// evolve-core，本插件只做基质/轨迹/部署四方法映射。复用 @harness/adapters 的
// HarnessPort 契约 + 纯函数（contentSha/inferKind/isStaticCoreRelPath）与错误类；
// 复用 @harness/l3-engine 的 Trajectory/LLMPort/bumpVersion。
//
// 映射（调研 §PLG-T04）：
//  - readSubstrate:  读 <hermesHome>/skills/<name>/SKILL.md（frontmatter + body）。
//  - writeSubstrate: 落 repoRoot staging（git versioned），active 不直接覆盖。
//  - readTrajectories: 读 <hermesHome>/state.db (SQLite, 只读) → Trajectory[]。
//  - deploy/rollback: git commit/checkout on repoRoot + 同步 hermesHome/skills/
//    （mtime 半热加载：下次查询生效，无需重启）。

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  HarnessPort,
  SubstrateHandle,
  DeployResult,
} from "@harness/adapters";
import {
  contentSha,
  inferKind,
  isStaticCoreRelPath,
  SubstrateNotFoundError,
  UnknownStagingError,
  StaticCoreWriteForbiddenError,
} from "@harness/adapters";
import type { LLMPort, Trajectory } from "@harness/l3-engine";
import { bumpVersion } from "@harness/l3-engine";
import { mapHermesSubstratePath } from "./substrate.js";
import { readHermesTrajectories } from "./trajectory.js";

/** HermesAdapter 选项。 */
export interface HermesAdapterOptions {
  /** 默认 process.env.HERMES_HOME ?? ~/.hermes。 */
  readonly hermesHome: string;
  /** skills git 版本化镜像目录（基质 staging/deploy 落此）。 */
  readonly repoRoot: string;
  /** 透传外部注入 LLMPort（Hermes 无原生 headless CLI 契约）。 */
  readonly llmPort: LLMPort;
  /** 默认 <hermesHome>/state.db。 */
  readonly dbPath?: string;
}

interface StagingEntry {
  readonly id: string;
  readonly mappedPath: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * Hermes Agent HarnessPort 适配器。
 *
 * 6 方法映射严格按 §PLG-T04 调研；进化逻辑（generate/score/select/retain/
 * archive/canary）全部 delegate @harness/evolve-core，本类不重造。
 */
export class HermesAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly hermesHome: string;
  private readonly repoRoot: string;
  private readonly dbPath: string;
  private readonly staging: Map<string, StagingEntry> = new Map();
  /** 最近一次部署的 substrate id（rollback 用来定位 checkout 目标）。 */
  private lastDeployedMappedPath: string | undefined;

  constructor(opts: HermesAdapterOptions) {
    this.hermesHome = opts.hermesHome;
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
    this.dbPath = opts.dbPath ?? join(opts.hermesHome, "state.db");
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapHermesSubstratePath(id);
    const abs = join(this.hermesHome, rel);
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
    if (isStaticCoreRelPath(id)) {
      throw new StaticCoreWriteForbiddenError(id);
    }
    const sha = contentSha(content);
    const mappedPath = mapHermesSubstratePath(id);
    // 落 staging（不直接覆盖 active）：repoRoot/.harness/staging/<sha>/<basename>
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, basename(mappedPath) || "substrate");
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, mappedPath, content, sha });
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha,
    }) as SubstrateHandle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return readHermesTrajectories(this.dbPath, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 active 文件（repoRoot 镜像 = staging 内容）
    const abs = join(this.repoRoot, entry.mappedPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.mappedPath)}`, {
      cwd: this.repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const version = bumpVersion(basename(entry.mappedPath));
    execSync(`git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`, {
      cwd: this.repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const newHead = this.gitHead();
    this.lastDeployedMappedPath = entry.mappedPath;
    // 同步到 hermesHome/skills/（mtime 半热加载：下次查询生效）
    this.syncToHermesHome(entry.mappedPath, entry.content);
    // 提示（不强制重启——调研明确 skills mtime 缓存半热加载）
    process.stdout.write(
      "[hermes] skill mtime cache will pick up on next query (semi-hot reload)\n",
    );
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    const mappedPath = this.lastDeployedMappedPath;
    if (!mappedPath) return;
    execSync(`git checkout ${rollbackTo} -- ${JSON.stringify(mappedPath)}`, {
      cwd: this.repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    // 同步回滚后的 active 内容到 hermesHome
    const abs = join(this.repoRoot, mappedPath);
    if (existsSync(abs)) {
      this.syncToHermesHome(mappedPath, readFileSync(abs, "utf8"));
    }
  }

  /** 把 repoRoot active 内容同步到 hermesHome（mtime 半热加载）。 */
  private syncToHermesHome(mappedPath: string, content: string): void {
    try {
      const abs = join(this.hermesHome, mappedPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    } catch {
      // hermesHome 不可写 / 不存在 → 容错跳过（git 镜像已落，不阻塞 deploy）
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
 * 工厂：返回一个 HermesAdapter（HarnessPort）。CLI registry 共用。
 */
export function createHermesPlugin(opts: HermesAdapterOptions): HarnessPort {
  return new HermesAdapter(opts);
}
