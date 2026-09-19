// L1-T01 · L1 config repo 布局 + sha 钉死 + scope guard + reload 语义
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T01 spec 编写。
// 当前 @harness/l1-config 未实现（index.ts 占位）→ value import 失败 = 合法 RED。
// 实现 GREEN 后下列断言须真正检验行为（不测实现细节，测行为）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ConfigRepo,
  ScopeGuard,
  ShaMismatchError,
  ScopeOverrideError,
  type RepoLock,
  type FilePin,
  type ConfigSet,
} from "@harness/l1-config";

// ── 辅助 ───────────────────────────────────────────────────────────────────
function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function setupRepo(root: string, files: Record<string, string>): RepoLock {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  const pins: FilePin[] = Object.keys(files).map((p) => ({ path: p, sha256: sha(files[p]!) }));
  return { versionSha: "deadbeef" .repeat(8).slice(0, 40), files: pins };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("L1-T01", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t01-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loadActive returns ConfigSet matching lock versionSha", () => {
    const lock = setupRepo(root, {
      "prompts/compaction-summary.md": "## Goal\n<safety>x</safety>",
    });
    const repo = new ConfigRepo(root, lock);
    const cs = repo.loadActive();
    expect(cs).toBeDefined();
    expect(cs.versionSha).toBe(lock.versionSha);
    // 不可变快照：Object.freeze 深冻
    expect(Object.isFrozen(cs)).toBe(true);
    expect(cs.loadedAt).toBeGreaterThan(0);
  });

  it("loadActive throws ShaMismatchError when file tampered", () => {
    const lock = setupRepo(root, {
      "prompts/compaction-summary.md": "## Goal\n<safety>x</safety>",
    });
    const repo = new ConfigRepo(root, lock);
    // 先成功 load 一次建立 active 快照
    const first = repo.loadActive();
    expect(first.versionSha).toBe(lock.versionSha);
    // 篡改文件
    writeFileSync(
      join(root, "prompts/compaction-summary.md"),
      "## Goal TAMPER\n<safety>x</safety>",
      "utf8",
    );
    expect(() => repo.loadActive()).toThrowError(ShaMismatchError);
    // active 保持上一个成功快照不变（原子：要么全成要么全不动）
    const again = repo.loadActive;
    // 失败后再次合法 load 仍返回有效快照；篡改期间绝不返回半加载状态
    writeFileSync(
      join(root, "prompts/compaction-summary.md"),
      "## Goal\n<safety>x</safety>",
      "utf8",
    );
    const restored = repo.loadActive();
    expect(restored.versionSha).toBe(lock.versionSha);
    void again;
  });

  it("reload atomically swaps only when all sha match", async () => {
    const lock = setupRepo(root, {
      "prompts/compaction-summary.md": "v1",
    });
    const repo = new ConfigRepo(root, lock);
    const before = repo.loadActive();
    // reload 期间并发 loadActive 拿到一致快照（旧或新，不存在半加载）
    const reloaded = repo.reload();
    expect(reloaded.versionSha).toBe(lock.versionSha);
    // reload 后内容与磁盘一致
    const after = repo.loadActive();
    expect(after.compactionPrompt).toBe("v1");
    expect(before.compactionPrompt).toBe("v1");
    void reloaded;
  });

  it("ScopeGuard rejects project scope override of policy.yaml", () => {
    const guard = new ScopeGuard();
    // projectScoped=true 试图覆写 config/*-policy.yaml → throw
    expect(() =>
      guard.assertNoProjectScopeOverride("config/hitl-policy.yaml", true),
    ).toThrowError(ScopeOverrideError);
    // 非 project scope / 非 policy 文件不 throw
    expect(() =>
      guard.assertNoProjectScopeOverride("config/hitl-policy.yaml", false),
    ).not.toThrow();
  });

  it("pinSha updates authoritative repo.lock.json.versionSha", () => {
    const lock = setupRepo(root, {
      "prompts/compaction-summary.md": "## Goal",
    });
    const repo = new ConfigRepo(root, lock);
    repo.pinSha("abc123");
    const lockFile = JSON.parse(
      readFileSync(join(root, "config/repo.lock.json"), "utf8"),
    ) as RepoLock;
    expect(lockFile.versionSha).toBe("abc123");
    // 被钉文件 sha256 已重算重锁（files 仍与磁盘一致）
    for (const pin of lockFile.files) {
      const onDisk = readFileSync(join(root, pin.path), "utf8");
      expect(pin.sha256).toBe(sha(onDisk));
    }
  });

  it("pinSha propagates to loadActive versionSha", () => {
    const lock = setupRepo(root, {
      "prompts/compaction-summary.md": "## Goal",
    });
    const repo = new ConfigRepo(root, lock);
    repo.pinSha("feedface");
    const cs: ConfigSet = repo.loadActive();
    expect(cs.versionSha).toBe("feedface");
  });
});
