// ADP-T02: pi 适配器 — PiAdapter + PiHeadlessLLM（mock 子进程为主体）
//
// 覆盖 spec（execution/adapt/TASKS.md §ADP-T02）的 Given/When/Then 全部场景：
//   1. readSubstrate 读 piHome prompts（content + sha）
//   2. writeSubstrate 落 repoRoot staging，active（piHome）未被直接改
//   3. readTrajectories 解析 TL-T01 形状 JSONL 为 Trajectory[]
//   4. readTrajectories 跳过非法 JSONL 行不崩
//   5. PiHeadlessLLM spawn pi -p --model <m> 返回 stdout（mock，断言 argv）
//   6. PiHeadlessLLM 非零 exit 重试后 throw PiHeadlessError
//   7. PiHeadlessLLM 超时 kill + throw PiHeadlessTimeout（不重试）
//   8. deploy 版本后缀 + git commit + 打印重启提示
//   9. rollback git-checkout 到 rollbackTo sha
//  10. readSubstrate piHome 不存在 prompt → SubstrateNotFoundError
//
// RED state: @harness/adapters 未实现 → import 失败 = 合法 RED。
// 真实 pi 往返 smoke 见 T02-pi-smoke.spec.ts（skipIf 无 pi 环境）。
//
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import {
  PiAdapter,
  PiHeadlessLLM,
  PiHeadlessError,
  PiHeadlessTimeout,
  SubstrateNotFoundError,
} from "@harness/adapters";
import type { PiAdapterOptions } from "@harness/adapters";
import type { Trajectory } from "@harness/l3-engine";
import {
  makeGitRepo,
  GitRepo,
  writeTlJsonl,
  makeFailedTlSession,
  mkdtempPiHome,
  makeFakePiBin,
  type FakePiBin,
} from "./fixtures/helpers";

// ---------------------------------------------------------------------------
// PiHeadlessLLM 单元（真实 fake pi 二进制，端到端覆盖 spawn 语义）
//
// 说明：spec §ADP-T02 RED 原写 "vi.mock child_process"，但 vitest 的
// vi.mock / vi.doMock / vi.spyOn 对 `node:child_process` 内建模块均不生效
// （built-in 导出冻结 + 不经 vitest loader，实测 mock factory 永不装配）。
// 改用真实 fake pi 二进制（makeFakePiBin）验证同一批行为：spawn argv、
// 非零 exit 重试、超时 kill。比 mock 更真实地覆盖子进程语义。
// ---------------------------------------------------------------------------

/** 轮询 marker 文件最多 ms 毫秒（容忍 SIGTERM 异步送达 + impl await-exit）。 */
async function waitForMarker(fake: FakePiBin, ms = 2000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fake.markerWritten()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fake.markerWritten();
}

describe("ADP-T02 · PiHeadlessLLM (real fake-pi binary)", () => {
  it("spawns pi -p --model <m> and returns stdout", async () => {
    // Given fake pi 成功输出 stdout
    const fake = makeFakePiBin({ stdout: "MUTANT_JSON" });
    try {
      const llm = new PiHeadlessLLM({
        piBin: fake.path,
        model: "anthropic/claude-sonnet-4",
      });
      // When complete
      const out = await llm.complete("produce mutation");
      // Then 返回 stdout
      expect(out).toBe("MUTANT_JSON");
      // And spawn argv 含 ['-p'] 与 '--model' <model>（fake pi 回写 argv）
      const argv = fake.readArgv();
      expect(argv).toContain("-p");
      const modelIdx = argv.indexOf("--model");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(argv[modelIdx + 1]).toBe("anthropic/claude-sonnet-4");
    } finally {
      fake.destroy();
    }
  });

  it("retries on non-zero exit then throws PiHeadlessError", async () => {
    // Given fake pi 每次 exit code=2 + stderr
    const fake = makeFakePiBin({ stdout: "", stderr: "pi error", exitCode: 2 });
    try {
      const llm = new PiHeadlessLLM({
        piBin: fake.path,
        model: "m/x",
        maxRetries: 2,
        timeoutMs: 5000,
      });
      // When/Then complete 重试 2 次后 throw PiHeadlessError
      let caught: unknown;
      try {
        await llm.complete("x");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PiHeadlessError);
      // spawn 调用 3 次（首次 + 2 重试，fake pi 计数文件佐证）
      expect(fake.spawnCount()).toBe(3);
      // PiHeadlessError 含 stderr + exitCode
      if (caught instanceof PiHeadlessError) {
        expect(caught.exitCode).toBe(2);
        expect(caught.stderr).toContain("pi error");
      }
    } finally {
      fake.destroy();
    }
  });

  it("kills + throws PiHeadlessTimeout on timeout (no retry)", async () => {
    // Given fake pi 挂死（setInterval，收到 SIGTERM 写 marker）
    const fake = makeFakePiBin({ hang: true });
    try {
      const llm = new PiHeadlessLLM({
        piBin: fake.path,
        model: "m/x",
        timeoutMs: 50,
        maxRetries: 3,
      });
      // When/Then complete 超时 → throw PiHeadlessTimeout
      await expect(llm.complete("x")).rejects.toBeInstanceOf(PiHeadlessTimeout);
      // And kill（SIGTERM）送达：marker 被写入
      expect(await waitForMarker(fake)).toBe(true);
      // And 不重试（spawn 只调一次）
      expect(fake.spawnCount()).toBe(1);
    } finally {
      fake.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// PiAdapter 行为（temp git repo + piHome fixture）
// ---------------------------------------------------------------------------

describe("ADP-T02 · PiAdapter GWT", () => {
  let repo: GitRepo;
  let piHome: string;
  let promptRel: string;

  beforeEach(() => {
    repo = makeGitRepo();
    piHome = mkdtempPiHome();
    // piHome 含 prompts/compaction-summary.md
    promptRel = "compaction-summary.md";
    const promptsDir = join(piHome, "prompts");
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, promptRel), "# pi prompt\nbaseline\n", "utf8");
    // repoRoot 镜像目录也 git 版本化同一 prompt
    repo.writeFile(`prompts/${promptRel}`, "# pi prompt\nbaseline\n");
    repo.commit("baseline pi substrate");
  });

  afterEach(() => {
    repo.destroy();
    rmSync(piHome, { recursive: true, force: true });
  });

  function makeAdapter(opts: Partial<PiAdapterOptions> = {}): PiAdapter {
    return new PiAdapter({
      piHome,
      repoRoot: repo.root,
      model: "anthropic/claude-sonnet-4",
      ...opts,
    });
  }

  it("readSubstrate reads piHome prompts", async () => {
    const adapter = makeAdapter();
    const handle = await adapter.readSubstrate(`pi/prompts/${promptRel}`);
    expect(handle.content).toContain("baseline");
    expect(handle.sha).toBeTruthy();
  });

  it("writeSubstrate lands in repoRoot staging, active untouched", async () => {
    const activeBefore = readFileSync(join(piHome, "prompts", promptRel), "utf8");
    const adapter = makeAdapter();
    const staged = await adapter.writeSubstrate(
      `pi/prompts/${promptRel}`,
      "# pi prompt\nMUTATED\n",
    );
    // piHome active 未被直接改
    expect(readFileSync(join(piHome, "prompts", promptRel), "utf8")).toBe(
      activeBefore,
    );
    // staging 落在 repoRoot
    expect(staged.sha).toBeTruthy();
  });

  it("readTrajectories parses TL-T01 shaped JSONL into Trajectory[]", async () => {
    // Given TL-T01 形状 JSONL 落在 projects/<encoded-cwd>/<sid>.jsonl
    const tlDir = join(piHome, "projects", "encoded-repo");
    const sid = "sess-pi-1";
    writeTlJsonl(tlDir, sid, makeFailedTlSession(sid));
    const adapter = makeAdapter({ trajectoryBaseDir: tlDir } as Partial<PiAdapterOptions>);
    // When readTrajectories
    const trajs: Trajectory[] = await adapter.readTrajectories("any-sha");
    // Then 返回 Trajectory[]，sessionId 匹配
    expect(trajs.length).toBeGreaterThanOrEqual(1);
    expect(trajs[0]!.sessionId).toBe(sid);
    expect(trajs[0]!.failed).toBe(true);
  });

  it("readTrajectories skips malformed JSONL lines without throwing", async () => {
    const tlDir = join(piHome, "projects", "encoded-repo");
    mkdirSync(tlDir, { recursive: true });
    // 合法行 + 非法行混合
    const sid = "sess-mixed-1";
    const good = makeFailedTlSession(sid);
    const file = join(tlDir, `${sid}.jsonl`);
    writeFileSync(
      file,
      good.map((n) => JSON.stringify(n)).join("\n") +
        "\nTHIS IS NOT JSON\n{broken\n",
      "utf8",
    );
    const adapter = makeAdapter({ trajectoryBaseDir: tlDir } as Partial<PiAdapterOptions>);
    // When/Then 不崩，仍返回合法轨迹
    const trajs = await adapter.readTrajectories("any-sha");
    expect(trajs.length).toBeGreaterThanOrEqual(1);
  });

  it("deploy bumps version + git commits + prints restart hint", async () => {
    const adapter = makeAdapter();
    const staged = await adapter.writeSubstrate(
      `pi/prompts/${promptRel}`,
      "# pi prompt\nDEPLOYED\n",
    );
    const headBefore = repo.head();
    // 捕获 console.log
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await adapter.deploy(staged.sha);
    // Then git HEAD 前进
    expect(repo.head()).not.toBe(headBefore);
    expect(result.version).toBeTruthy();
    expect(result.rollbackTo).toBe(headBefore);
    // And 打印重启提示
    const restartHint = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes("restart"));
    expect(restartHint).toBeDefined();
    logSpy.mockRestore();
  });

  it("rollback git-checkouts to rollbackTo sha", async () => {
    const adapter = makeAdapter();
    const original = repo.read(`prompts/${promptRel}`);
    const staged = await adapter.writeSubstrate(
      `pi/prompts/${promptRel}`,
      "# MUTATED\nrollback target\n",
    );
    const result = await adapter.deploy(staged.sha);
    expect(repo.read(`prompts/${promptRel}`)).not.toBe(original);
    // When rollback
    await adapter.rollback(result.rollbackTo);
    // Then active 还原
    expect(repo.read(`prompts/${promptRel}`)).toBe(original);
  });

  it("readSubstrate unknown piHome prompt throws SubstrateNotFoundError", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.readSubstrate("pi/prompts/no-such-file.md"),
    ).rejects.toBeInstanceOf(SubstrateNotFoundError);
  });
});
