// L1-T01 · L1 config repo 布局 + sha 钉死 + 项目 scope 不可覆写 + reload 语义
//
// 被进化基质必须 git-versioned 且 sha 钉死（PRD §4.3 / §11.2 / §11.3）。
// reload 须原子：重读磁盘 → 重验 sha + 签名 → 原子 swap active 快照，
// agent 运行时只读快照永不热改。

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ── 公共类型 ───────────────────────────────────────────────────────────────

export interface FilePin {
  readonly path: string;
  readonly sha256: string;
}

export interface RepoLock {
  readonly versionSha: string;
  readonly files: readonly FilePin[];
}

export interface ConfigSet {
  readonly versionSha: string;
  readonly compactionPrompt: string;
  readonly phasePrompts: Readonly<Record<"init" | "coding" | "review", string>>;
  readonly loadedAt: number;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

export class ShaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShaMismatchError";
  }
}

export class ScopeOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeOverrideError";
  }
}

// ── 纯函数：sha 校验 ───────────────────────────────────────────────────────

/** 计算字符串内容的 sha256 hex。 */
function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 可选 safety 段签名校验器（T03 runtime 第二层守卫）。
 *
 * 由 `SignatureVerifier`（signature.ts）结构实现。`ConfigRepo.loadActive()`
 * 在 sha 钉死校验通过、`ConfigSet` swap **之前**调用 `verify`：
 * 签名失配 → throw，绝不 swap（T03 执行提示(1) 硬保证 + §0.4 契约不变量）。
 * 这使得即使攻击者绕过 pre-commit 并更新可写的 `repo.lock.json` 文件 sha256
 * 匹配篡改内容，只读的 L0 static-core 签名清单仍能拒载——active 不被毒化。
 */
export interface SegmentVerifier {
  /** 该文件是否在签名清单中（是 → load 时校验 safety 段 sha256）。 */
  hasEntry(filePath: string): boolean;
  /** 校验文件 content 的 safety 段 sha256 与清单一致；失配 → throw。 */
  verify(filePath: string, content: string): void;
}

/**
 * 校验 lock 中每个文件的 sha256 与磁盘一致。
 * 任一失配 → 抛 `ShaMismatchError`（含失配文件路径）。
 * 全部一致 → 返回从磁盘读取的文件内容 map（path → content）。
 */
export function verifyFiles(
  root: string,
  files: readonly FilePin[],
): Map<string, string> {
  const contents = new Map<string, string>();
  for (const pin of files) {
    const abs = join(root, pin.path);
    const content = readFileSync(abs, "utf8");
    const actual = sha256(content);
    if (actual !== pin.sha256) {
      throw new ShaMismatchError(
        `sha256 mismatch for ${pin.path}: expected ${pin.sha256}, got ${actual}`,
      );
    }
    contents.set(pin.path, content);
  }
  return contents;
}

// ── ConfigSet 构建（immutable record） ──────────────────────────────────────

const COMPACTION_PATH = "prompts/compaction-summary.md";
const PHASE_PATHS: Readonly<Record<"init" | "coding" | "review", string>> = {
  init: "prompts/phase-init.md",
  coding: "prompts/phase-coding.md",
  review: "prompts/phase-review.md",
};

/**
 * 从校验通过的文件内容 map 构建不可变 ConfigSet 快照。
 * 单基质 repo（无 phase 文件）时 phasePrompts 为空对象 `{}`（ERRATA-w2plus L1-T01）。
 */
function buildConfigSet(
  versionSha: string,
  contents: Map<string, string>,
): ConfigSet {
  const compactionPrompt = contents.get(COMPACTION_PATH) ?? "";
  // 单基质 repo 时无 phase 文件 → 空对象 {}；按 ERRATA 裁决保持运行时为空对象。
  const phasePrompts: Record<"init" | "coding" | "review", string> = {} as Record<
    "init" | "coding" | "review",
    string
  >;
  for (const key of ["init", "coding", "review"] as const) {
    const p = PHASE_PATHS[key];
    if (contents.has(p)) {
      phasePrompts[key] = contents.get(p)!;
    }
  }
  const cs: ConfigSet = {
    versionSha,
    compactionPrompt,
    phasePrompts: Object.freeze(phasePrompts),
    loadedAt: Date.now(),
  };
  return Object.freeze(cs) as ConfigSet;
}

// ── ConfigRepo ─────────────────────────────────────────────────────────────

/**
 * L1 配置仓库。读 active 快照（agent 运行时入口）；reload 原子 swap；
 * pinSha 钉死 git HEAD sha 并重锁文件 sha256。
 *
 * `repo.lock.json.versionSha` 是 `ConfigSet.versionSha` 的唯一权威来源。
 */
export class ConfigRepo {
  private readonly root: string;
  private lock: RepoLock;
  private active: ConfigSet | null = null;
  // 可选 safety 段签名校验器（T03 第二层）。null → loadActive 跳过签名校验
  // （T01 单基质场景 / 未接线时退化为纯 sha 钉死，向后兼容）。一旦由
  // PhaseSubstrate.load 接线，loadActive 在 swap 前重算 safety 段 sha256
  // 比对只读清单，失配即 throw 不 swap——active 绝不被毒化。
  private segmentVerifier: SegmentVerifier | null = null;
  // 简单 Mutex：保证 reload / loadActive 原子 swap（同步路径下用 token 标志，
  // 异步并发场景由调用方串行化；本实现保证单次 loadActive 期间 active 不被半改）。
  private swapping = false;

  constructor(root: string, lock: RepoLock) {
    this.root = root;
    this.lock = lock;
  }

  /**
   * 暴露 repo root 绝对路径供下游 commit-on-success（T04b/T05b）写 active +
   * staging 版本后缀文件、以及 canary 配置面写 `config/canary-shadow.yaml`。
   * 纯只读访问器，不改变既有 load/reload/pinSha 行为（additive accessor）。
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * 接线 safety 段签名校验器（runtime 第二层守卫）。
   * 接线后，`loadActive` / `reload` 在 sha 钉死通过后、`ConfigSet` swap 之前，
   * 对清单覆盖的文件重算 safety 段 sha256 比对，失配 → throw 不 swap。
   * 传 null 可卸载（仅用于测试隔离）。
   */
  setSegmentVerifier(verifier: SegmentVerifier | null): void {
    this.segmentVerifier = verifier;
  }

  /**
   * 在 sha 钉死通过后、swap 之前，对清单覆盖的文件做 safety 段签名校验。
   * 失配 → throw（`SignatureTamperError` 等），active 保持旧快照不 swap。
   * 无接线校验器 → no-op（向后兼容 T01 单基质场景）。
   */
  private verifySignatures(contents: Map<string, string>): void {
    if (!this.segmentVerifier) return;
    for (const [path, content] of contents) {
      if (this.segmentVerifier.hasEntry(path)) {
        // 在 swap 之前校验：失配即 throw，绝不返回半加载状态
        this.segmentVerifier.verify(path, content);
      }
    }
  }

  /** repo.lock.json 在仓库中的权威路径。 */
  private get lockPath(): string {
    return join(this.root, "config/repo.lock.json");
  }

  /**
   * 读 active 快照（agent 运行时入口）。
   * 校验每文件 sha256 与 lock 一致 → 返回不可变快照。
   * 任一失配 → throw `ShaMismatchError`，绝不返回半加载状态，active 保持旧快照。
   */
  loadActive(): ConfigSet {
    // reload 期间并发 loadActive 拿到旧快照（swap 原子，不存在半加载态）
    if (this.swapping && this.active !== null) {
      return this.active;
    }
    const contents = verifyFiles(this.root, this.lock.files);
    // T03 第二层：sha 钉死通过后、swap 之前校验 safety 段签名。
    // 失配 → throw，active 保持旧快照（绝不 swap 篡改内容）。
    this.verifySignatures(contents);
    const cs = buildConfigSet(this.lock.versionSha, contents);
    // 原子 swap：仅在 sha + 签名校验全部通过后才赋值 active
    this.active = cs;
    return cs;
  }

  /**
   * 离线重读磁盘 + 重算 sha + 重验签名 → 原子 swap active 快照。
   * 失败（sha/签名失配）→ throw，active 保持旧快照。
   */
  reload(): ConfigSet {
    this.swapping = true;
    try {
      const contents = verifyFiles(this.root, this.lock.files);
      // T03 第二层：sha 钉死通过后、swap 之前校验 safety 段签名。
      this.verifySignatures(contents);
      const cs = buildConfigSet(this.lock.versionSha, contents);
      // 原子 swap
      this.active = cs;
      return cs;
    } finally {
      this.swapping = false;
    }
  }

  /**
   * 钉死 git HEAD sha：
   * (1) 更新 `repo.lock.json.versionSha = sha`（权威真值源）；
   * (2) 重算被钉文件 sha256 并写回 `repo.lock.json.files` 实现重锁（relock）；
   * (3) reload-policy.yaml 仅记 lastPinnedAt，不持独立 versionSha（本任务不写该文件，
   *     由后续任务扩展；versionSha 唯一权威在 repo.lock.json）。
   */
  pinSha(sha: string): void {
    // 重算被钉文件 sha256（基于磁盘当前内容）
    const relockedFiles: FilePin[] = this.lock.files.map((pin) => {
      const abs = join(this.root, pin.path);
      const content = readFileSync(abs, "utf8");
      return { path: pin.path, sha256: sha256(content) };
    });
    const newLock: RepoLock = {
      versionSha: sha,
      files: relockedFiles,
    };
    // 持久化到 config/repo.lock.json（权威真值源）
    const lockAbs = this.lockPath;
    mkdirSync(dirname(lockAbs), { recursive: true });
    writeFileSync(lockAbs, JSON.stringify(newLock, null, 2), "utf8");
    // 更新内存权威，使后续 loadActive 反映新 versionSha（单一真值源贯穿）
    this.lock = newLock;
    // 失效旧 active，强制下次 loadActive 重验 + 反映新 versionSha
    this.active = null;
  }
}

// ── ScopeGuard ─────────────────────────────────────────────────────────────

/**
 * 项目 scope 不可覆写守卫（PRD §11.2）。
 * 防 prompt-injected 仓库改 `config/*-policy.yaml` 偷数据。
 */
export class ScopeGuard {
  /** 判定文件路径是否属于项目 scope 不可覆写的 policy 文件。 */
  private isProjectScopedPolicy(file: string): boolean {
    // 形如 config/foo-policy.yaml 或 config/sub/foo-policy.yaml
    const norm = file.replace(/\\/g, "/");
    return (
      norm.startsWith("config/") && /-policy\.ya?ml$/i.test(norm.split("/").pop() ?? "")
    );
  }

  /**
   * 断言项目 scope 不得覆写 policy 文件。
   * `projectScoped=true` 且 file 为 `config/*-policy.yaml` → throw `ScopeOverrideError`。
   */
  assertNoProjectScopeOverride(file: string, projectScoped: boolean): void {
    if (projectScoped && this.isProjectScopedPolicy(file)) {
      throw new ScopeOverrideError(
        `project scope override of policy file not allowed: ${file}`,
      );
    }
  }
}
