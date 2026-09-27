// PLG-T12: GrokAdapter — Grok Build HarnessPort 适配器。
//
// Spec: execution/plugin/TASKS.md §PLG-T12（grok-adapter.ts）。
//
// 复用铁律（§0.2）：
//  - HarnessPort/SubstrateHandle/DeployResult/SubstrateNotFoundError/UnknownStagingError
//    复用 @harness/adapters port.ts
//  - `ClaudeCodeAdapter`（@harness/adapters ADP-T03）——grok 读 CLAUDE.md/AGENTS.md/
//    .claude/rules/，`grok/claude/<rest>` 基质读写**直接委托**，不重写（调研核实
//    "Grok Build 兼容 Claude Code 生态"）
//  - exam-lock 锁定语义复用 ADP-T03（hooks.json PreToolUse 考卷锁定是其等价物）
//  - Trajectory/LLMPort/bumpVersion 从 @harness/l3-engine 导入
//  - runEvolutionCycle offline 模式复用 PLG-T01（同 Cursor PLG-T06）
//
// 自研边界：id 路由（claude-compat 委托 vs grok-plugin 原生）+ grok 插件目录
// staging 读写 + trajectory offline 降级（sessionLogPath 未核实恒 []）。
// **禁止**在插件包内实现 generate/score/select/retain/archive/canary 进化逻辑。

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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
import { ClaudeCodeAdapter } from "@harness/adapters";
import { bumpVersion } from "@harness/l3-engine";
import type { Trajectory, LLMPort } from "@harness/l3-engine";

import { readGrokTrajectories } from "./trajectory.js";

/** GrokAdapter 选项（spec 接口签名逐字对齐）。 */
export interface GrokAdapterOptions {
  /** CLAUDE.md/AGENTS.md/.claude/rules/ + .grok/plugins/ git 版本化目录。 */
  readonly repoRoot: string;
  /** 委托 ClaudeCodeAdapter 的轨迹源参数（默认 ~/.claude）。 */
  readonly claudeHome: string;
  /** 透传外部注入的 LLMPort。 */
  readonly llmPort: LLMPort;
  /**
   * grok 会话日志路径：执行时经 docs 核实后注入；未核实则 undefined → offline
   * 降级（readTrajectories 恒 []，同 Cursor PLG-T06）。
   */
  readonly sessionLogPath?: string;
}

/** grok 基质 id 前缀。 */
export const GROK_CLAUDE_PREFIX = "grok/claude/";
export const GROK_PLUGIN_PREFIX = "grok/plugins/";

/** id 路由结果：claude-compat 委托 vs grok-plugin 原生。 */
export type RoutedSubstrateId =
  | { readonly kind: "claude-compat"; readonly inner: string }
  | { readonly kind: "grok-plugin"; readonly inner: string };

/**
 * 把 grok 基质 id 路由到对应处理分支。
 *
 *  - `grok/claude/<rest>`    → claude-compat（剥前缀委托 ClaudeCodeAdapter）
 *  - `grok/plugins/<rest>`   → grok-plugin（映射 `.grok/plugins/<rest>`）
 *  - 其余                     → 抛 SubstrateNotFoundError（未知 id 形态）
 */
export function routeSubstrateId(id: string): RoutedSubstrateId {
  if (id.startsWith(GROK_CLAUDE_PREFIX)) {
    return { kind: "claude-compat", inner: id.slice(GROK_CLAUDE_PREFIX.length) };
  }
  if (id.startsWith(GROK_PLUGIN_PREFIX)) {
    return { kind: "grok-plugin", inner: id.slice(GROK_PLUGIN_PREFIX.length) };
  }
  throw new SubstrateNotFoundError(id);
}

interface GrokStagingEntry {
  readonly id: string;
  readonly repoRel: string;
  readonly content: string;
  readonly sha: string;
}

/** 构造 immutable SubstrateHandle（复用 contentSha + inferKind）。 */
function makeSubstrateHandle(
  id: string,
  content: string,
): SubstrateHandle {
  return Object.freeze({
    id,
    kind: inferKind(id),
    content,
    sha: contentSha(content),
  }) as SubstrateHandle;
}

/**
 * Grok Build harness 适配器：薄委托 ClaudeCodeAdapter（CLAUDE.md/AGENTS.md/
 * .claude/rules/ 兼容层）+ grok 原生插件目录（.grok/plugins/evolve/）。
 *
 * 轨迹：sessionLogPath 未核实 → offline 降级（readTrajectories 恒 []）。
 * LLM：透传外部注入的 LLMPort。
 */
export class GrokAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly repoRoot: string;
  private readonly sessionLogPath: string | undefined;
  private readonly claudeCompat: ClaudeCodeAdapter;
  private readonly staging: Map<string, GrokStagingEntry> = new Map();

  constructor(opts: GrokAdapterOptions) {
    this.repoRoot = opts.repoRoot;
    // exactOptionalPropertyTypes：仅在传入时赋值。
    this.sessionLogPath = opts.sessionLogPath;
    this.llmPort = opts.llmPort;
    this.claudeCompat = new ClaudeCodeAdapter({
      repoRoot: opts.repoRoot,
      claudeHome: opts.claudeHome,
      llmPort: opts.llmPort,
    });
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const route = routeSubstrateId(id);
    if (route.kind === "claude-compat") {
      // 薄委托：grok/claude/<rest> → ClaudeCodeAdapter.readSubstrate(<rest>)
      return this.claudeCompat.readSubstrate(route.inner);
    }
    // grok-plugin：grok/plugins/<rest> → repoRoot/.grok/plugins/<rest>
    const rel = `.grok/plugins/${route.inner}`;
    const abs = join(this.repoRoot, rel);
    if (!existsSync(abs)) {
      throw new SubstrateNotFoundError(id);
    }
    const content = readFileSync(abs, "utf8");
    return makeSubstrateHandle(id, content);
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const route = routeSubstrateId(id);
    if (route.kind === "claude-compat") {
      return this.claudeCompat.writeSubstrate(route.inner, content);
    }
    // grok-plugin：落 repoRoot staging（active 未被直接覆盖；deploy 时再写 active）。
    const rel = `.grok/plugins/${route.inner}`;
    const handle = makeSubstrateHandle(id, content);
    const sha = handle.sha;
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, rel.replace(/[\\/]+/g, "__"));
    writeFileSync(stagingPath, content, "utf8");
    this.staging.set(sha, { id, repoRel: rel, content, sha });
    return handle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    // 轨迹未核实 → offline 降级（恒 []）；sessionLogPath 注入才解析。
    return readGrokTrajectories(this.sessionLogPath, substrateSha);
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (entry) {
      return this.deployGrokPlugin(entry);
    }
    // 无 grok-plugin staging → 委托 claude-compat（claude 前缀基质 deploy）。
    return this.claudeCompat.deploy(stagingSha);
  }

  async rollback(rollbackTo: string): Promise<void> {
    // grok-plugin 回滚：取最后写入的 grok-plugin staging entry，git checkout。
    let entry: GrokStagingEntry | undefined;
    for (const e of this.staging.values()) entry = e;
    if (entry) {
      execSync(
        `git checkout ${rollbackTo} -- ${JSON.stringify(entry.repoRel)}`,
        { cwd: this.repoRoot },
      );
    }
    // claude-compat 回滚（无 claude staging 时 no-op）。
    await this.claudeCompat.rollback(rollbackTo);
  }

  private deployGrokPlugin(entry: GrokStagingEntry): DeployResult {
    const headBefore = this.gitHead();
    const abs = join(this.repoRoot, entry.repoRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -- ${JSON.stringify(entry.repoRel)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(basename(entry.repoRel));
    execSync(
      `git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`,
      { cwd: this.repoRoot },
    );
    const newHead = this.gitHead();
    // 调研热加载未核实 → 保守打印开新 session 提示。
    // 用 process.stdout.write（非 console.log）以便测试捕获 stdout。
    process.stdout.write(
      `[grok] plugin dir + claude-compat substrate effective on next grok session\n`,
    );
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
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
 * 插件工厂：harness id → HarnessPort（CLI registry 共用，对齐 EvolvePluginFactory）。
 */
export function createGrokPlugin(opts: GrokAdapterOptions): HarnessPort {
  return new GrokAdapter(opts);
}
