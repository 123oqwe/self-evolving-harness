// PLG-T06: CursorAdapter — HarnessPort 落到 Cursor harness（离线进化模式）。
//
// Spec: execution/plugin/TASKS.md §PLG-T06 (cursor-adapter.ts)。
// 复用铁律（§0.2）——插件包只做 4 方法映射，不重造进化逻辑：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError 复用 ADP-T01 port.ts
//  - Trajectory/LLMPort/bumpVersion 从 @harness/l3-engine 导入
//  - runEvolutionCycle（offline 模式）复用 @harness/evolve-core（不在本包重造闭环）
//  - 轨迹：Cursor 无文件级导出（调研已核实）→ readTrajectories 恒返回 []（离线铁律）
//  - LLM：透传外部注入的 LLMPort
//  - 部署：写回 .cursor/rules/*.mdc + git commit；规则自动发现（下次 session 注入，无需重启）

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
  mapCursorSubstratePath,
  makeCursorSubstrateHandle,
  cursorSubstrateBasename,
} from "./substrate.js";

/** CursorAdapter 选项（spec 接口签名逐字对齐）。 */
export interface CursorAdapterOptions {
  /** .cursor/rules/ git 版本化目录。 */
  readonly repoRoot: string;
  /** LLM 透传（外部注入）。 */
  readonly llmPort: LLMPort;
}

interface StagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/** Cursor 离线进化模式自动发现提示（spec 行为规范逐字对齐）。 */
export const CURSOR_AUTO_DISCOVER_HINT =
  "[cursor] rule auto-discovered on next agent chat session (no restart needed)";

/**
 * Cursor harness 适配器（离线进化模式）。
 *
 *  - 基质 = `.cursor/rules/<name>.mdc`（YAML frontmatter + markdown body）
 *  - 轨迹 = 恒 `[]`（Cursor 无文件级轨迹导出，离线模式铁律——不是 TODO）
 *  - 部署 = 写回 `.cursor/rules/*.mdc` + git commit + 自动发现提示
 *  - LLM  = 透传外部注入的 LLMPort
 */
export class CursorAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly repoRoot: string;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: CursorAdapterOptions) {
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const rel = mapCursorSubstratePath(id);
    const abs = join(this.repoRoot, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeCursorSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const rel = mapCursorSubstratePath(id);
    const handle = makeCursorSubstrateHandle(id, content);
    const sha = handle.sha;
    // 落 repoRoot staging（active 未被直接覆盖；deploy 时再写 active）。
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: rel, content, sha });
    return handle;
  }

  async readTrajectories(_substrateSha: string): Promise<Trajectory[]> {
    // 离线铁律：Cursor 无文件级轨迹导出（调研已核实），恒返回 []。
    // canary 评分驱动直接变异（mutator 拿空 diagnosis，退化为纯 beam-search +
    // canary verify 信号）。若未来 Cursor 新增导出，再改本包，不在本任务臆测。
    return [];
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 repoRoot active（.cursor/rules/*.mdc，git 版本化目录）。
    const abs = join(this.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(cursorSubstrateBasename(entry.id));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
    // 自动发现提示：规则文件放入 .cursor/rules 即被自动发现，下次 session 注入。
    process.stdout.write(`${CURSOR_AUTO_DISCOVER_HINT}\n`);
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
      { cwd: this.repoRoot, stdio: "ignore" },
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
 * 工厂：构造 Cursor HarnessPort 插件（CLI registry 共用形态）。
 */
export function createCursorPlugin(opts: CursorAdapterOptions): HarnessPort {
  return new CursorAdapter(opts);
}
