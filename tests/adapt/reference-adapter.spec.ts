// ADP-T01: HarnessPort 适配器契约 — ReferenceAdapter 用 7 包证明契约完备
//
// 覆盖 spec（execution/adapt/TASKS.md §ADP-T01）的 Given/When/Then 全部场景：
//   1. readSubstrate 返回 active 内容 + sha（对齐 L1-T01 loadActive）
//   2. writeSubstrate 落 staging，active 未被直接覆盖（staging 隔离边界）
//   3. readTrajectories 返回 failed 非 luckyPass 轨迹（复用 L3-T03 入口守卫语义）
//   4. deploy 把 active 替换为版本后缀 + 记录 rollbackTo（对齐 L3-T08 bumpVersion）
//   5. rollback 把 active 还原到 rollbackTo sha（L1-T01 rollback 幂等不变量）
//   6. writeSubstrate 对 static-core 路径 throw（对齐 L3-T01 breaker）
//   7. readSubstrate 未知 id throw SubstrateNotFoundError（错误路径）
//   8. deploy 未知 stagingSha throw UnknownStagingError（错误路径）
//
// RED state: @harness/adapters 包未实现 → import 失败 = 合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为（reference-adapter 必须真走 git）。
//
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ReferenceAdapter,
  SubstrateNotFoundError,
  UnknownStagingError,
} from "@harness/adapters";
import type { HarnessPort, SubstrateHandle, DeployResult } from "@harness/adapters";
import { STATIC_CORE_PATHS } from "@harness/l3-engine";
import type { Trajectory } from "@harness/l3-engine";
import {
  FakeLLM,
  makeGitRepo,
  GitRepo,
  writeTlJsonl,
  makeFailedTlSession,
} from "./fixtures/helpers";

// ---------------------------------------------------------------------------
// 契约完备性元断言：HarnessPort 7 方法/字段必须在 ReferenceAdapter 实例上存在
// ---------------------------------------------------------------------------

describe("ADP-T01 · HarnessPort 契约钉子", () => {
  it("HarnessPort 契约定义了 7 个必需成员（readSubstrate/writeSubstrate/readTrajectories/deploy/rollback/llmPort）", () => {
    // Given HarnessPort 类型存在
    // When 取 ReferenceAdapter 原型与实例
    const adapter = new ReferenceAdapter({
      repoRoot: "/tmp/nonexistent",
      llm: new FakeLLM(),
    });
    // Then 契约 6 方法 + 1 字段全存在
    expect(typeof adapter.readSubstrate).toBe("function");
    expect(typeof adapter.writeSubstrate).toBe("function");
    expect(typeof adapter.readTrajectories).toBe("function");
    expect(typeof adapter.deploy).toBe("function");
    expect(typeof adapter.rollback).toBe("function");
    expect(adapter.llmPort).toBeDefined();
    expect(typeof adapter.llmPort.complete).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ReferenceAdapter 行为（真走 git temp repo）
// ---------------------------------------------------------------------------

describe("ADP-T01 · ReferenceAdapter GWT", () => {
  let repo: GitRepo;
  let substrateRel: string;
  let baseSha: string;

  beforeEach(() => {
    repo = makeGitRepo();
    substrateRel = "packages/l1-config/prompts/compaction-summary.md";
    repo.writeFile(substrateRel, "# compaction summary\nbaseline prompt\n");
    baseSha = repo.commit("baseline substrate");
  });

  afterEach(() => {
    repo.destroy();
  });

  it("readSubstrate returns content + sha matching L1 fixture", async () => {
    // Given repo 含一个 prompt 基质文件 + FakeLLM
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    // When readSubstrate
    const handle: SubstrateHandle = await adapter.readSubstrate(substrateRel);
    // Then 返回 kind='prompt' + content==文件内容 + sha 非空
    expect(handle.kind).toBe("prompt");
    expect(handle.content).toContain("baseline prompt");
    expect(handle.sha).toBeTruthy();
    expect(handle.sha.length).toBeGreaterThan(0);
  });

  it("writeSubstrate lands in staging without touching active", async () => {
    // Given active 基质已存在
    const activeBefore = repo.sha256(substrateRel);
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    // When writeSubstrate 写入变异内容
    const newContent = "# compaction summary\nMUTATED prompt v2\n";
    const staged: SubstrateHandle = await adapter.writeSubstrate(
      substrateRel,
      newContent,
    );
    // Then active 文件 sha256 未变（未被直接覆盖）
    expect(repo.sha256(substrateRel)).toBe(activeBefore);
    // And staging 文件存在且 sha ≠ 原 sha
    expect(staged.sha).not.toBe(baseSha);
    expect(staged.content).toContain("MUTATED prompt v2");
  });

  it("readTrajectories returns failed non-lucky-pass trajectories", async () => {
    // Given TL JSONL fixture 含一条 luckyPass=true + 一条 luckyPass=false
    const tlDir = join(repo.root, ".harness", "projects", "encoded-repo");
    const sidFail = "sess-fail-1";
    const sidLucky = "sess-lucky-1";
    // 失败非 lucky-pass 轨迹
    const failNodes = makeFailedTlSession(sidFail);
    writeTlJsonl(tlDir, sidFail, failNodes);
    // lucky-pass 轨迹（同形状，标记 luckyPass）
    const luckyNodes = makeFailedTlSession(sidLucky);
    writeTlJsonl(tlDir, sidLucky, luckyNodes);
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
      trajectoryDir: tlDir,
      // 测试用注入：把 sidLucky 标记为 luckyPass（模拟 CE-T03 过滤前的原始流）
      markLuckyPass: (sessionId: string) => sessionId === sidLucky,
    });
    // When readTrajectories(baseSha)
    const trajs: Trajectory[] = await adapter.readTrajectories(baseSha);
    // Then 只返回 luckyPass!==true 的 failed 轨迹（defense-in-depth）
    expect(trajs.length).toBe(1);
    expect(trajs[0]!.failed).toBe(true);
    expect(trajs[0]!.luckyPass).not.toBe(true);
    expect(trajs[0]!.sessionId).toBe(sidFail);
  });

  it("deploy swaps active with version suffix + records rollbackTo", async () => {
    // Given staging 已落盘
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    const newContent = "# compaction summary\nMUTATED deploy v2\n";
    const staged = await adapter.writeSubstrate(substrateRel, newContent);
    const headBefore = repo.head();
    // When deploy(staged.sha)
    const result: DeployResult = await adapter.deploy(staged.sha);
    // Then active 内容 == staging 内容
    expect(repo.read(substrateRel)).toContain("MUTATED deploy v2");
    // And version 匹配 bumpVersion 格式（非空、含版本号）
    expect(result.version).toBeTruthy();
    expect(result.version.length).toBeGreaterThan(0);
    // And rollbackTo == 部署前 sha
    expect(result.rollbackTo).toBe(headBefore);
    // And 部署后产生新 git commit（HEAD 前进）
    expect(repo.head()).not.toBe(headBefore);
  });

  it("rollback restores active to rollbackTo sha byte-for-byte", async () => {
    // Given deploy 已发生
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    const originalContent = repo.read(substrateRel);
    const staged = await adapter.writeSubstrate(
      substrateRel,
      "# MUTATED\nwill be rolled back\n",
    );
    const result = await adapter.deploy(staged.sha);
    expect(repo.read(substrateRel)).not.toBe(originalContent);
    // When rollback(rollbackTo)
    await adapter.rollback(result.rollbackTo);
    // Then active 内容逐字节 == rollbackTo 版本
    expect(repo.read(substrateRel)).toBe(originalContent);
  });

  it("writeSubstrate to static-core path throws (L3-T01 breaker)", async () => {
    // Given STATIC_CORE_PATHS 非空
    expect(STATIC_CORE_PATHS.length).toBeGreaterThan(0);
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    const staticPath = STATIC_CORE_PATHS[0]!;
    // When/Then writeSubstrate 对 static-core 路径 → throw
    await expect(
      adapter.writeSubstrate(staticPath, "evil mutation"),
    ).rejects.toThrow();
  });

  it("readSubstrate unknown id throws SubstrateNotFoundError", async () => {
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    // When/Then readSubstrate 不存在 id → throw SubstrateNotFoundError
    await expect(
      adapter.readSubstrate("does/not/exist.md"),
    ).rejects.toBeInstanceOf(SubstrateNotFoundError);
  });

  it("deploy unknown stagingSha throws UnknownStagingError", async () => {
    const adapter = new ReferenceAdapter({
      repoRoot: repo.root,
      llm: new FakeLLM(),
    });
    // When/Then deploy 对未知 stagingSha → throw UnknownStagingError
    await expect(adapter.deploy("sha-not-in-staging")).rejects.toBeInstanceOf(
      UnknownStagingError,
    );
  });
});
