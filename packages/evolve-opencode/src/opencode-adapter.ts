// PLG-T03: OpenCodeAdapter — HarnessPort 落到 OpenCode (opencode.ai)。
//
// Spec: execution/plugin/TASKS.md §PLG-T03 (opencode-adapter.ts).
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError/UnknownStagingError
//    复用 @harness/adapters port.ts
//  - Trajectory/LLMPort/bumpVersion 从 @harness/l3-engine 导入
//  - 基质 sha/kind 推断复用 substrate.ts（复用 contentSha/inferKind）
//  - 轨迹解析复用 trajectory.ts（自写三层 JSON 重组，不复用 extractDiagnosis）
//  - L3-T08 bumpVersion 复用；L1-T01 git checkout 回滚语义复用
// 自研边界（§0.2 自研边界）：只做 (a) 基质 id→.opencode/ 路径映射、
//  (b) OpenCode 私有 storage 三层 JSON→Trajectory 解析、(c) deploy 写回
//  .opencode/ 活跃基质目录、(d) llmPort 透传。禁止实现任何进化逻辑。

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

import { resolveLlmPort } from "./llm.js";
import { readOpenCodeTrajectories } from "./trajectory.js";
import {
  mapOpenCodeSubstratePath,
  makeSubstrateHandle,
  substrateBasename,
} from "./substrate.js";

/** OpenCodeAdapter 选项。 */
export interface OpenCodeAdapterOptions {
  /** OpenCode config 目录（基质源），默认 process.env.OPENCODE_CONFIG_DIR ?? ~/.config/opencode。 */
  readonly configDir: string;
  /** OpenCode data 目录（轨迹源 = $XDG_DATA_HOME/opencode），默认 process.env.XDG_DATA_HOME/opencode。 */
  readonly dataDir: string;
  /** .opencode/ git 版本化镜像目录（如本 repo）。 */
  readonly repoRoot: string;
  /** 透传外部注入 LLMPort（OpenCode 无原生 headless CLI 契约）。 */
  readonly llmPort: LLMPort;
}

interface StagingEntry {
  readonly id: string;
  /** repoRoot 内 git 版本化相对路径（如 `.opencode/AGENTS.md`）。 */
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * OpenCode harness 适配器：
 *  - 基质 = `.opencode/`（opencode.json 片段 + AGENTS.md + plugins/*.ts）
 *  - 轨迹 = `dataDir/storage/session/{info,message,part}/*.json` 三层 JSON
 *  - 部署 = 写回 `.opencode/` 基质 + git commit + 提示重启（无热加载）
 *  - LLM = 透传外部注入
 */
export class OpenCodeAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly configDir: string;
  private readonly dataDir: string;
  private readonly repoRoot: string;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: OpenCodeAdapterOptions) {
    this.configDir = opts.configDir;
    this.dataDir = opts.dataDir;
    this.repoRoot = opts.repoRoot;
    this.llmPort = resolveLlmPort(opts.llmPort);
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapOpenCodeSubstratePath(id);
    const abs = join(this.configDir, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapOpenCodeSubstratePath(id);
    const handle = makeSubstrateHandle(id, content);
    const sha = handle.sha;
    // 落 repoRoot staging（configDir active 不直接覆盖；deploy 时写 active）。
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    // repoRel = `.opencode/<rel>`（git 版本化相对路径）。
    const repoRel = join(".opencode", rel);
    this.staging.set(sha, { id, repoRel, content, sha });
    return handle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return readOpenCodeTrajectories(this.dataDir, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active（.opencode/<rel>，git 版本化镜像目录）。
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
    // 同步 configDir active（部署生效；configDir 通常 == repoRoot/.opencode，
    // 但测试/生产可能注入不同 configDir，故显式同步）。
    try {
      const rel = mapOpenCodeSubstratePath(entry.id);
      const cfgAbs = join(this.configDir, rel);
      mkdirSync(join(cfgAbs, ".."), { recursive: true });
      writeFileSync(cfgAbs, entry.content, "utf8");
    } catch {
      // configDir 不可写不阻塞 deploy（git 已落）。
    }
    // 提示重启 opencode 以加载新基质（调研明确运行中不热重载）。
    // 直写 process.stdout（而非 console.log）以兼容测试对 stdout 的捕获
    // （vitest 拦截 console.log，不经过 process.stdout.write）。
    process.stdout.write("[opencode] restart opencode to load new substrate\n");
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
    execSync(`git checkout ${rollbackTo} -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // 同步 configDir active 到回滚后内容。
    try {
      const rel = mapOpenCodeSubstratePath(entry.id);
      const cfgAbs = join(this.configDir, rel);
      const restored = readFileSync(join(this.repoRoot, entry.repoRel), "utf8");
      mkdirSync(join(cfgAbs, ".."), { recursive: true });
      writeFileSync(cfgAbs, restored, "utf8");
    } catch {
      /* ignore */
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

/** 工厂：返回 OpenCodeAdapter 实例（implements HarnessPort）。 */
export function createOpenCodePlugin(
  opts: OpenCodeAdapterOptions,
): HarnessPort {
  return new OpenCodeAdapter(opts);
}
