// ADP-T02: PiAdapter — HarnessPort 落到 pi harness。
//
// Spec: execution/adapt/TASKS.md §ADP-T02 (pi-adapter.ts).
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError 复用 ADP-T01 port.ts
//  - Trajectory/LLMPort 从 @harness/l3-engine 导入
//  - TL-T01 轨迹解析复用 trajectory.ts（复用 extractDiagnosis）
//  - L1-T01 git checkout 回滚语义 / L3-T08 bumpVersion 复用
//  - PiHeadlessLLM（headless-llm.ts）= REAL-T01 RealLLMPort 同实现

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

import { PiHeadlessLLM } from "./headless-llm.js";
import { readTlTrajectories } from "./trajectory.js";
import {
  mapSubstratePath,
  makeSubstrateHandle,
  substrateBasename,
} from "./substrate.js";

/** PiAdapter 选项。 */
export interface PiAdapterOptions {
  /** pi home 目录（基质源），默认 ~/.pi/agent。 */
  readonly piHome: string;
  /** 基质 git 版本化镜像目录（如本 repo）。 */
  readonly repoRoot: string;
  /** pi `--model` pattern，如 'anthropic/claude-sonnet-4'。 */
  readonly model?: string;
  /** pi 二进制路径，默认 'pi'，测试可注入 fake。 */
  readonly piBin?: string;
  /** TL-T01 轨迹目录覆盖（默认 <piHome>/../projects 即 ~/.pi/projects）。 */
  readonly trajectoryBaseDir?: string;
  /** 注入 LLMPort（默认用 PiHeadlessLLM）。测试可注入 FakeLLM。 */
  readonly llmPort?: LLMPort;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/**
 * pi harness 适配器：基质=~/.pi/agent/{settings.json,prompts,skills}，
 * 轨迹=TL-T01 TranscriptWriter 落盘 JSONL，LLM=`pi -p` 无头子进程，
 * 部署=git 版本化 repoRoot + 提示重启。
 */
export class PiAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly piHome: string;
  private readonly repoRoot: string;
  private readonly trajectoryBaseDir: string;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: PiAdapterOptions) {
    this.piHome = opts.piHome;
    this.repoRoot = opts.repoRoot;
    this.trajectoryBaseDir =
      opts.trajectoryBaseDir ?? join(opts.piHome, "..", "projects");
    // exactOptionalPropertyTypes: true — 不可把 `string | undefined` 显式赋给
    // `piBin?: string`/`model?: string`，须按字段是否存在条件构造 options。
    this.llmPort = opts.llmPort ?? this.buildDefaultLlmPort(opts);
  }

  /**
   * 默认 LLMPort 工厂：把 PiAdapterOptions 的可选 piBin/model 转成
   * PiHeadlessLLMOptions。exactOptionalPropertyTypes 下不可把 `string|undefined`
   * 显式赋给 `piBin?: string`/`model?: string`，须按字段是否存在条件构造。
   */
  private buildDefaultLlmPort(opts: PiAdapterOptions): LLMPort {
    const headlessOpts: { piBin?: string; model?: string } = {};
    if (opts.piBin !== undefined) headlessOpts.piBin = opts.piBin;
    if (opts.model !== undefined) headlessOpts.model = opts.model;
    return new PiHeadlessLLM(headlessOpts);
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapSubstratePath(id);
    const abs = join(this.piHome, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapSubstratePath(id);
    const sha = makeSubstrateHandle(id, content).sha;
    // 落 repoRoot staging（piHome active 不直接覆盖；deploy 时同步到 piHome）。
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: rel, content, sha });
    return makeSubstrateHandle(id, content);
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    return readTlTrajectories(this.trajectoryBaseDir, substrateSha);
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
    const version = bumpVersion(substrateBasename(entry.id));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
    // 同步到 piHome active（部署生效）。
    try {
      const piAbs = join(this.piHome, entry.repoRel);
      mkdirSync(join(piAbs, ".."), { recursive: true });
      writeFileSync(piAbs, entry.content, "utf8");
    } catch {
      // piHome 不可写不阻塞 deploy（git 已落）。
    }
    // 提示重启 pi 以加载新基质（不自动 kill 进程）。
    // eslint-disable-next-line no-console
    console.log("[pi] restart pi to load new substrate");
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
    });
    // 同步 piHome active 到回滚后内容。
    try {
      const piAbs = join(this.piHome, entry.repoRel);
      const restored = readFileSync(join(this.repoRoot, entry.repoRel), "utf8");
      mkdirSync(join(piAbs, ".."), { recursive: true });
      writeFileSync(piAbs, restored, "utf8");
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
