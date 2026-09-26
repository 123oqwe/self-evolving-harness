// ADP-T01: HarnessPort 适配器契约 + ReferenceAdapter（用 7 包作内建实现）
//
// Spec: execution/adapt/TASKS.md §ADP-T01.
//
// 复用铁律（§0.2）：本文件只定义契约类型 + ReferenceAdapter 组装件，不重造
// 已实现接口——`Substrate`/`SubstrateKind`/`Trajectory`/`LLMPort` 从
// `@harness/l3-engine` 导入；`STATIC_CORE_PATHS` 复用 L3-T01 常量；deploy/rollback
// 真走 git（temp repo fixture 可证明契约在真实 git 语义下完备）。

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { createHash } from "node:crypto";

import type {
  SubstrateKind,
  Trajectory,
  LLMPort,
} from "@harness/l3-engine";
import { STATIC_CORE_PATHS } from "@harness/l3-engine";
import { bumpVersion } from "@harness/l3-engine";

// ---------------------------------------------------------------------------
// 契约类型（spec 接口签名逐字对齐）
// ---------------------------------------------------------------------------

/** 基质句柄：被进化内容在宿主 harness 中的定位 + 内容 + sha。 */
export interface SubstrateHandle {
  readonly id: string; // 基质标识（如 'pi/compaction-summary.md'）
  readonly kind: SubstrateKind; // 复用 L3 SubstrateKind（prompt/workflow/skill/weight）
  readonly content: string; // 当前 active 内容
  readonly sha: string; // git/version sha（L1-T01 sha 钉死语义）
}

/** 发布动作结果。 */
export interface DeployResult {
  readonly version: string; // 版本后缀（L3-T08 bumpVersion 风格）
  readonly sha: string; // 部署后 sha
  readonly rollbackTo: string; // 回滚目标 sha（部署前 HEAD）
}

/**
 * Harness 无关适配器契约。任一 harness 宿主（pi / Claude Code / 通用）实现此接口
 * 即可被 L3 进化引擎消费。契约方法对齐已实现接口：
 *  - readSubstrate/writeSubstrate：对齐 L1-T01 ConfigRepo.loadActive/reload + sha 钉死
 *  - readTrajectories：对齐 L3-T03 Trajectory 形状（已过 CE-T03 Lucky-Pass 过滤）
 *  - deploy/rollback：对齐 L3-T08 Retain.commit + L1-T01 git checkout 回滚
 *  - llmPort：对齐 L3-T03 LLMPort（RealLLMPort 在 REAL-T01 落地）
 */
export interface HarnessPort {
  /** 读基质当前 active 内容 + sha（只读快照，对齐 L1-T01 loadActive）。 */
  readSubstrate(id: string): Promise<SubstrateHandle>;
  /** 写回变异后内容（落 staging，不直接覆盖 active；对齐 L1-T01 commit-on-success + canary-shadow）。 */
  writeSubstrate(id: string, content: string): Promise<SubstrateHandle>;
  /** 读失败轨迹（形状 = L3-T03 Trajectory，须已过 CE-T03 Lucky-Pass 过滤）。 */
  readTrajectories(substrateSha: string): Promise<Trajectory[]>;
  /** 部署：写 active + 版本后缀 + 落 git commit（对齐 L3-T08 Retain.commit）。 */
  deploy(stagingSha: string): Promise<DeployResult>;
  /** 回滚：git checkout 到 rollbackTo sha（对齐 L1-T01 rollback / L3-T08 auto-revert）。 */
  rollback(rollbackTo: string): Promise<void>;
  /** LLM 调用 port（RealLLMPort 在 REAL-T01 实现；测试用 FakeLLM）。 */
  readonly llmPort: LLMPort;
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** readSubstrate 对不存在 id → throw。 */
export class SubstrateNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`substrate not found: ${id}`);
    this.name = "SubstrateNotFoundError";
    this.id = id;
  }
}

/** deploy 对未知 stagingSha → throw。 */
export class UnknownStagingError extends Error {
  readonly stagingSha: string;
  constructor(stagingSha: string) {
    super(`unknown staging sha: ${stagingSha}`);
    this.name = "UnknownStagingError";
    this.stagingSha = stagingSha;
  }
}

/** writeSubstrate 对 static-core 路径 → throw（对齐 L3-T01 breaker）。 */
export class StaticCoreWriteForbiddenError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`write forbidden: path is static-core (L3-T01 breaker): ${path}`);
    this.name = "StaticCoreWriteForbiddenError";
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// 纯函数 helper（T02/T03 复用）
// ---------------------------------------------------------------------------

/**
 * 计算文件内容的 sha256（git/version sha 钉死语义：内容变 → sha 变）。
 * 纯函数，无副作用，便于 T02/T03 复用。
 */
export function contentSha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * 在 repoRoot 内对某相对路径跑 `git hash-object`（blob sha）；若文件不存在或非
 * git repo 则回退到 contentSha(readFile)。纯 git 语义备用，T02/T03 可直接复用。
 */
export function gitSha(absPath: string, repoRoot: string): string {
  try {
    return execSync(`git hash-object -- ${JSON.stringify(absPath)}`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return contentSha(readFileSync(absPath, "utf8"));
  }
}

/**
 * 从基质 id 推断 SubstrateKind（prompt/workflow/skill/weight）。
 *  - .md 在 prompts/ 下 → prompt
 *  - /skills/ 路径 → skill
 *  - /workflows/ 路径 → workflow
 *  - 其余 .md → prompt（默认）
 *  - 其余 → weight（占位，T02/T03 可覆写）
 */
export function inferKind(id: string): SubstrateKind {
  if (id.includes("/skills/")) return "skill";
  if (id.includes("/workflows/")) return "workflow";
  if (extname(id) === ".md") return "prompt";
  return "weight";
}

/**
 * static-core 守卫：repo-root-relative id 是否落入 STATIC_CORE_PATHS 任一子树。
 * 用路径分隔符边界匹配（与 L0C-T11 isStaticCorePath 同语义，但不依赖 process.cwd，
 * 便于在 temp repo fixture 下工作）。
 */
export function isStaticCoreRelPath(id: string): boolean {
  const norm = id.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const dir of STATIC_CORE_PATHS) {
    const d = dir.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm === d) return true;
    if (norm.startsWith(d + "/")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ReferenceAdapter：用已实现的 7 包作内建实现，证明 HarnessPort 契约完备
// ---------------------------------------------------------------------------

export interface ReferenceAdapterOptions {
  /** git 版本化目录（基质源 = repoRoot 下相对 id 指向的文件）。 */
  readonly repoRoot: string;
  /** 注入的 LLMPort（FakeLLM / RealLLMPort）。 */
  readonly llm: LLMPort;
  /** TL-T01 JSONL 轨迹目录（默认 <repoRoot>/.harness/projects/encoded-repo）。 */
  readonly trajectoryDir?: string;
  /**
   * 测试用注入：把某 sessionId 标记为 luckyPass（模拟 CE-T03 过滤前的原始流）。
   * 生产路径由 CE-T03 Lucky-Pass 过滤器上游标记；ReferenceAdapter 在此做
   * defense-in-depth 二次过滤（luckyPass!==true 才返回）。
   */
  readonly markLuckyPass?: (sessionId: string) => boolean;
}

interface StagingEntry {
  readonly id: string;
  readonly content: string;
  readonly sha: string;
  readonly stagingPath: string;
}

/**
 * Reference adapter：用已实现的 7 包作内建实现，证明 HarnessPort 契约完备。
 *  - 基质源 = repoRoot git 版本化目录（id 为 repo-root-relative 路径）
 *  - 轨迹源 = TL-T01 JSONL（经 Lucky-Pass 过滤）
 *  - LLM = 注入的 LLMPort（FakeLLM / RealLLMPort）
 *  - deploy/rollback = git commit / git checkout（真走 git）
 */
export class ReferenceAdapter implements HarnessPort {
  public readonly llmPort: LLMPort;
  private readonly repoRoot: string;
  private readonly trajectoryDir: string;
  private readonly markLuckyPass: ((sessionId: string) => boolean) | undefined;
  private readonly staging: Map<string, StagingEntry> = new Map();

  constructor(opts: ReferenceAdapterOptions) {
    this.repoRoot = opts.repoRoot;
    this.llmPort = opts.llm;
    this.trajectoryDir =
      opts.trajectoryDir ??
      join(opts.repoRoot, ".harness", "projects", "encoded-repo");
    this.markLuckyPass = opts.markLuckyPass;
  }

  async readSubstrate(id: string): Promise<SubstrateHandle> {
    const abs = join(this.repoRoot, id);
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
    // 落 staging（不直接覆盖 active）：repoRoot/.harness/staging/<sha>/<basename>
    const stagingDir = join(this.repoRoot, ".harness", "staging", sha);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(stagingDir, basename(id) || "substrate");
    writeFileSync(stagingPath, content, "utf8");
    const entry: StagingEntry = { id, content, sha, stagingPath };
    this.staging.set(sha, entry);
    return Object.freeze({
      id,
      kind: inferKind(id),
      content,
      sha,
    }) as SubstrateHandle;
  }

  async readTrajectories(substrateSha: string): Promise<Trajectory[]> {
    if (!existsSync(this.trajectoryDir)) {
      return [];
    }
    const files = readdirSync(this.trajectoryDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    const out: Trajectory[] = [];
    for (const file of files) {
      const sessionId = file.slice(0, -".jsonl".length);
      const abs = join(this.trajectoryDir, file);
      let nodes: unknown[] = [];
      try {
        const text = readFileSync(abs, "utf8");
        nodes = text
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l));
      } catch {
        // 非法 JSONL 行 → 跳过该 session（defense-in-depth，不崩）
        continue;
      }
      const diag = extractDiagnosis(nodes);
      if (diag === null) {
        // 该 session 无失败信号 → 不是失败轨迹，跳过
        continue;
      }
      const lucky = this.markLuckyPass ? this.markLuckyPass(sessionId) : false;
      if (lucky === true) {
        // CE-T03 Lucky-Pass 过滤（defense-in-depth 二次守卫）
        continue;
      }
      out.push({
        id: sessionId,
        sessionId,
        substrateSha,
        failed: true,
        diagnosis: diag,
        luckyPass: lucky,
        raw: nodes,
      });
    }
    return out;
  }

  async deploy(stagingSha: string): Promise<DeployResult> {
    const entry = this.staging.get(stagingSha);
    if (!entry) {
      throw new UnknownStagingError(stagingSha);
    }
    const headBefore = this.gitHead();
    // 写 active 文件（用 staging 内容替换 active）
    const abs = join(this.repoRoot, entry.id);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    // git add + commit（真走 git）
    execSync(`git add -- ${JSON.stringify(entry.id)}`, {
      cwd: this.repoRoot,
    });
    const version = bumpVersion(basename(entry.id));
    execSync(`git commit -q -m ${JSON.stringify(`deploy ${entry.id} ${version}`)}`, {
      cwd: this.repoRoot,
    });
    const newHead = this.gitHead();
    return Object.freeze({
      version,
      sha: newHead,
      rollbackTo: headBefore,
    }) as DeployResult;
  }

  async rollback(rollbackTo: string): Promise<void> {
    // 找回当前 active 基质（staging 中最新部署的 id），checkout 到 rollbackTo
    // ReferenceAdapter 的 rollback 语义：把所有受管基质文件还原到 rollbackTo 版本。
    // 取当前 staging 中记录的 id（最后一个部署的基质）作回滚目标。
    let targetId: string | undefined;
    for (const entry of this.staging.values()) {
      targetId = entry.id;
    }
    if (targetId) {
      execSync(
        `git checkout ${rollbackTo} -- ${JSON.stringify(targetId)}`,
        { cwd: this.repoRoot },
      );
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

// ---------------------------------------------------------------------------
// TL-T01 JSONL → 失败诊断提取（纯函数，便于复用/单测）
// ---------------------------------------------------------------------------

interface TlLikeNode {
  readonly type?: string;
  readonly content?: unknown;
}

/**
 * 从 TL-T01 TranscriptNode[] 提取失败诊断文本。
 * 命中 assistant 节点 content 含 `is_error: true` 的 tool_result → 返回其 content 文本；
 * 未命中失败信号 → 返回 null（调用方据此跳过非失败 session）。
 */
export function extractDiagnosis(nodes: unknown[]): string | null {
  for (const node of nodes as TlLikeNode[]) {
    if (node.type !== "assistant") continue;
    const content = node.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part && part.is_error === true) {
        const c = part.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) {
          const txt = c
            .map((x) =>
              typeof x === "string" ? x : (x as { text?: string })?.text ?? "",
            )
            .join(" ");
          if (txt.trim()) return txt;
        }
        return JSON.stringify(c);
      }
    }
  }
  return null;
}
