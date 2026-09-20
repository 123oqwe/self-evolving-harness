// L1-T04b · canary 发布管线配置面：shadow 切换 + `git checkout` 回滚接口
//
// Spec: execution/L1-config/TASKS.md §L1-T04b。
//
// 本模块是 CE-T06（canary 发布管线本体）的**配置面**——只写
// `config/canary-shadow.yaml` 指向 staging 路径 + 调回滚接口，不重复实现
// 发布管线本体（职责边界由 spec §L1-T04b 执行提示(3) 钉死）。
//
// 回滚接口 `rollback`：生产路径封装 `git checkout -- <file>`（CE-T06
// `src/revert.ts` / L3-T08 `git-client.ts` 提供命令构造本体，single ownership）。
// 在非 git 工作区（单元测试 / 离线快照模式）下退化为快照恢复：commit-on-success
// 写 active 前已把基线内容存入 `rollbackStore`，rollback 从中恢复——这与
// `git checkout -- <file>` 把工作区改动丢弃回 HEAD 的语义等价（active 回到
// 回滚前 HEAD = 基线），且保证幂等（无快照 → no-op exit 0）。
//
// 回滚错误路径：`git checkout` 在 git 工作区中失败（如工作区脏导致 checkout
// 拒绝）→ throw `RollbackFailedError` + 落安全事件 session log（spec 行为规范）。

import { execFileSync } from "node:child_process";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * `git checkout` 回滚失败（如工作区脏）。spec §L1-T04b 回滚错误路径。
 */
export class RollbackFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackFailedError";
  }
}

// ── 回滚快照存储 ───────────────────────────────────────────────────────────
//
// commit-on-success（`SelectRetain.commitOnSuccess`）写 active 前把基线内容
// 存入此 store，键为 active 文件绝对路径；`CanaryConfigPlane.rollback` 从中
// 恢复（非 git 工作区退化路径 / 单元测试模式）。模块级 Map：测试间以不同
// tempdir 绝对路径天然隔离，无键冲突；恢复后即删键以保证幂等。
const rollbackStore: Map<string, string> = new Map();

// ── CanaryConfigPlane ──────────────────────────────────────────────────────

/**
 * CanaryConfigPlane 构造 opts。
 *
 * `repo`：ConfigRepo，提供 root（写 `config/canary-shadow.yaml`、定位 git
// 工作区）。ERRATA-w2plus 风格：opts 结构化注入。
 */
export interface CanaryConfigPlaneOptions {
  readonly repo: ConfigRepo;
}

/**
 * canary 发布管线**配置面**（非本体）：variant 进 staging → shadow 5% →
 * 退化信号 → `git checkout` 回滚（PRD §6.4 / §8.1 交付物 #7）。
 *
 * 不重复实现 CE-T06 发布管线本体；只写配置 + 调回滚接口。
 */
export class CanaryConfigPlane {
  private readonly repo: ConfigRepo;

  constructor(opts: CanaryConfigPlaneOptions) {
    this.repo = opts.repo;
  }

  /**
   * 将 variant 落 staging（version-suffixed，如 `compaction-summary.v2.md`）。
   * 返回 staging 绝对路径。
   *
   * substrate='compaction' → `staging/compaction-summary.v{N}.md`，N 为现有
   * 最大版本号 +1（无则 2，Voyager 起始约定）。
   */
  stageVariant(opts: {
    substrate: "compaction";
    variantPath: string;
  }): string {
    const root = this.repo.getRoot();
    const stagingDir = join(root, "staging");
    mkdirSync(stagingDir, { recursive: true });
    const next = nextCompactionVersion(stagingDir);
    const dest = join(stagingDir, `compaction-summary.v${next}.md`);
    const content = readFileSync(opts.variantPath, "utf8");
    writeFileSync(dest, content, "utf8");
    return dest;
  }

  /**
   * 写 `config/canary-shadow.yaml`，指向 staging 路径 + shadow 百分比。
   * percent=5 → canary shadow 5%；percent=100 → 全量切流（promote）。
   */
  enableShadow(stagingPath: string, percent: 5 | 100): void {
    const root = this.repo.getRoot();
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const yaml = [
      `substrate: compaction`,
      `shadowPath: ${stagingPath}`,
      `percent: ${percent}`,
      `enabled: true`,
      ``,
    ].join("\n");
    writeFileSync(join(configDir, "canary-shadow.yaml"), yaml, "utf8");
  }

  /**
   * 回滚单个文件到回滚前 HEAD（基线）。
   *
   * 生产路径：git 工作区内执行 `git checkout -- <file>`（CE-T06 回滚本体）。
   * 退化路径（非 git 工作区 / 单元测试）：从 `rollbackStore` 恢复基线快照。
   *
   * 幂等：无快照且 git 无改动可弃 → no-op exit 0。
   * 错误路径：git 工作区内 `git checkout` 失败 → throw `RollbackFailedError`。
   */
  rollback(filePath: string): void {
    const root = this.repo.getRoot();

    // 退化路径：先查快照 store（commit-on-success 写 active 前存入基线）
    if (rollbackStore.has(filePath)) {
      const baseline = rollbackStore.get(filePath)!;
      rollbackStore.delete(filePath); // 恢复后删键 → 后续 rollback 幂等
      writeFileSync(filePath, baseline, "utf8");
      return;
    }

    // 生产路径：git 工作区内 `git checkout -- <file>`
    if (isGitWorktree(root)) {
      const rel = toRel(root, filePath);
      try {
        execFileSync("git", ["checkout", "--", rel], {
          cwd: root,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (err) {
        // git checkout 失败（工作区脏等）→ 落安全事件 + throw
        const msg = err instanceof Error ? err.message : String(err);
        try {
          // 落安全事件 session log（best-effort，不掩盖原错误）
          const logDir = join(root, ".harness", "logs");
          mkdirSync(logDir, { recursive: true });
          writeFileSync(
            join(logDir, "rollback-failed.log"),
            `[${new Date().toISOString()}] rollback failed for ${filePath}: ${msg}\n`,
            "utf8",
          );
        } catch {
          /* best-effort: 日志落盘失败不掩盖原错误 */
        }
        throw new RollbackFailedError(
          `git checkout failed for ${filePath}: ${msg}`,
        );
      }
      return;
    }

    // 非 git 工作区且无快照 → 文件未变更，no-op exit 0（幂等）
    return;
  }
}

// ── 内部纯函数 ─────────────────────────────────────────────────────────────

/** 判断 root 是否为 git 工作区（含 `.git`）。 */
function isGitWorktree(root: string): boolean {
  return existsSync(join(root, ".git"));
}

/** 将绝对路径转为相对 root 的 posix 路径（git checkout 需要）。 */
function toRel(root: string, absPath: string): string {
  const rel = absPath.replace(root, "").replace(/^[\\/]+/, "");
  return rel.replace(/\\/g, "/");
}

/**
 * 扫描 staging 目录现有 `compaction-summary.v{N}.md`，返回下一版本号。
 * 无既有版本 → 2（Voyager 起始约定）；有 → max(N)+1。
 */
function nextCompactionVersion(stagingDir: string): number {
  let max = 1;
  if (existsSync(stagingDir)) {
    for (const name of readdirSafe(stagingDir)) {
      const m = /^compaction-summary\.v(\d+)\.md$/.exec(name);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}

export { rollbackStore };
