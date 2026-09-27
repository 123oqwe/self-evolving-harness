// plugin 模块测试共享 helper（PLG-T01–T12 复用）。
//
// Spec: execution/plugin/TASKS.md §0.5（测试约定）+ 附录 A（跨任务共享 helper）。
//
// 仅依赖 @harness/l3-engine 的 type-only import（transpile 时擦除，RED 态不阻塞）
// 与 @harness/adapters（已实现），以及 node 内建 fs/os/path/child_process。提供：
//   - FakeLLM(mode) — improve/degrade 固定变异内容（对齐 XM-T01 MutationSource）
//   - tempRepoFactory() — mkdtempSync + git init + initial commit（复用 adapt helpers 模式）
//   - FakeHarnessPort(opts) — in-memory HarnessPort，驱动 evolve-core 闭环测试
//   - which(bin) — 环境探针（command -v 门控，V2-C4 / ADP-T02 先例）

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { LLMPort, Trajectory } from "@harness/l3-engine";
import { bumpVersion } from "@harness/l3-engine";
import type { HarnessPort, SubstrateHandle, DeployResult } from "@harness/adapters";
import { contentSha, inferKind } from "@harness/adapters";

// ---------------------------------------------------------------------------
// FakeLLM — mode='improve' 返回加性变异，mode='degrade' 返回退化变异
// ---------------------------------------------------------------------------

export type FakeLLMMode = "improve" | "degrade";

export class FakeLLM implements LLMPort {
  public readonly calls: string[] = [];
  private readonly mode: FakeLLMMode;
  constructor(mode: FakeLLMMode = "improve") {
    this.mode = mode;
  }
  async complete(prompt: string): Promise<string> {
    this.calls.push(prompt);
    if (this.mode === "improve") {
      return "IMPROVED-MUTANT-CONTENT";
    }
    return "DEGRADED-MUTANT-CONTENT";
  }
}

// ---------------------------------------------------------------------------
// tempRepoFactory — temp git repo（git init + initial commit）
// ---------------------------------------------------------------------------

export interface TempRepo {
  root: string;
  writeFile(relPath: string, content: string): string;
  commit(message?: string): string;
  read(relPath: string): string;
  sha256(relPath: string): string;
  head(): string;
  destroy(): void;
}

export function tempRepoFactory(): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "plugin-repo-"));
  execSync("git init -q", { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  execSync('git config user.name "test"', { cwd: root });
  execSync("git config commit.gpgsign false", { cwd: root });
  return {
    root,
    writeFile(relPath, content) {
      const abs = join(root, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return relPath;
    },
    commit(message = "init") {
      execSync("git add -A", { cwd: root });
      execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: root });
      return execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    },
    read(relPath) {
      return readFileSync(join(root, relPath), "utf8");
    },
    sha256(relPath) {
      return createHash("sha256").update(readFileSync(join(root, relPath))).digest("hex");
    },
    head() {
      return execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    },
    destroy() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// FakeHarnessPort — in-memory HarnessPort 驱动 evolve-core 闭环
//
// 基质 = Map<id, content>；轨迹 = 预置 Trajectory[]；deploy/rollback 真走 git
// （复用 adapt ReferenceAdapter 语义：staging → active 覆盖 + git commit/checkout）。
// readTrajectories 调用计数 spy 供 offline 模式断言。
// ---------------------------------------------------------------------------

export interface FakeHarnessPortOptions {
  readonly repoRoot: string;
  readonly llmPort: LLMPort;
  readonly substrates?: Record<string, string>;
  readonly trajectories?: Trajectory[];
}

interface FakeStaging {
  readonly id: string;
  readonly content: string;
  readonly sha: string;
}

export class FakeHarnessPort implements HarnessPort {
  public readonly llmPort: LLMPort;
  public readTrajectoriesCallCount = 0;
  private readonly repoRoot: string;
  private readonly subs: Map<string, string>;
  private readonly trajs: Trajectory[];
  private readonly staging: Map<string, FakeStaging> = new Map();

  constructor(opts: FakeHarnessPortOptions) {
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llmPort;
    this.subs = new Map(Object.entries(opts.substrates ?? {}));
    this.trajs = opts.trajectories ?? [];
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const content = this.subs.get(id);
    if (content === undefined) {
      const { SubstrateNotFoundError } = require("@harness/adapters");
      throw new SubstrateNotFoundError(id);
    }
    return Object.freeze({ id, kind: inferKind(id), content, sha: contentSha(content) }) as SubstrateHandle;
  }

  async writeSubstrate(id: string, content: string): Promise<SubstrateHandle> {
    const sha = contentSha(content);
    this.staging.set(sha, { id, content, sha });
    return Object.freeze({ id, kind: inferKind(id), content, sha }) as SubstrateHandle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    this.readTrajectoriesCallCount += 1;
    return this.trajs.map((t) => ({ ...t, substrateSha }));
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      const { UnknownStagingError } = require("@harness/adapters");
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = execSync("git rev-parse HEAD", { cwd: this.repoRoot }).toString().trim();
    this.subs.set(entry.id, entry.content);
    const abs = join(this.repoRoot, entry.id);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    execSync(`git add -A`, { cwd: this.repoRoot });
    const version = bumpVersion(entry.id);
    execSync(`git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`, { cwd: this.repoRoot });
    const newHead = execSync("git rev-parse HEAD", { cwd: this.repoRoot }).toString().trim();
    return Object.freeze({ version, sha: newHead, rollbackTo: headBefore }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    // checkout 所有受管基质到 rollbackTo
    for (const id of this.subs.keys()) {
      execSync(`git checkout ${rollbackTo} -- ${JSON.stringify(id)}`, { cwd: this.repoRoot, stdio: "ignore" });
    }
  }
}

// ---------------------------------------------------------------------------
// which — 环境探针（command -v 门控）
// ---------------------------------------------------------------------------

export function which(bin: string): { exitCode: number } {
  try {
    const code = execSync(`command -v ${bin} >/dev/null 2>&1; echo $?`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return { exitCode: code === "0" ? 0 : 1 };
  } catch {
    return { exitCode: 1 };
  }
}

export function exists(p: string): boolean {
  return existsSync(p);
}
