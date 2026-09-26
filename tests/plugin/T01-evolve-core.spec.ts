// PLG-T01: evolve-core 包提炼 — 宿主无关进化循环入口。
//
// Spec: execution/plugin/TASKS.md §PLG-T01。
//
// RED 态：`@harness/evolve-core` 包未实现 → import 失败 = 合法 RED。
// 测试用 FakeHarnessPort（in-memory HarnessPort）+ FakeLLM + temp git repo
// 驱动 runEvolutionCycle 全闭环，断言 retain/canary publish/revert/offline/错误路径。
//
// canary verify 命令 = `grep -q IMPROVED prompt/compaction.md`：improve 变异内容
// 含 IMPROVED → exit 0 → resolve_rate=1 > baseline 0 → retained + PROMOTE；
// degrade 变异内容无 IMPROVED → exit 1 → rejected（retainedMutants===0）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  FakeHarnessPort,
  FakeLLM,
  tempRepoFactory,
} from "./helpers.js";
import type { EvolveCanaryTask } from "@harness/evolve-core";
import {
  runEvolutionCycle,
  // 类型仅用于断言形状（type-only，RED 擦除不阻塞）：
  //   EvolveConfig / EvolveResult / EvolvePluginFactory / InsufficientCanaryError
} from "@harness/evolve-core";
import { SubstrateNotFoundError } from "@harness/adapters";

const BASELINE_CONTENT = "# compaction\n\nBASELINE-CONTENT\n";
const SUBSTRATE_ID = "prompt/compaction.md";

function canaryTasks(repoRoot: string): EvolveCanaryTask[] {
  // grep deployed substrate file for IMPROVED marker (exit 0 = pass)
  const verify = `grep -q IMPROVED ${JSON.stringify(join(repoRoot, SUBSTRATE_ID))}`;
  return [
    { id: "c1", verify, expectedExit: 0 },
    { id: "c2", verify, expectedExit: 0 },
    { id: "c3", verify, expectedExit: 0 },
  ];
}

describe("PLG-T01 runEvolutionCycle", () => {
  let repo: { root: string; destroy: () => void; commit: (m?: string) => string };

  beforeEach(() => {
    repo = tempRepoFactory();
    repo.writeFile(SUBSTRATE_ID, BASELINE_CONTENT);
    repo.commit("baseline substrate");
  });
  afterEach(() => repo.destroy());

  it("retains mutant and promotes on improve", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
      substrates: { [SUBSTRATE_ID]: BASELINE_CONTENT },
      trajectories: [
        { id: "t1", sessionId: "t1", substrateSha: "x", failed: true, diagnosis: "diag-1" },
        { id: "t2", sessionId: "t2", substrateSha: "x", failed: true, diagnosis: "diag-2" },
        { id: "t3", sessionId: "t3", substrateSha: "x", failed: true, diagnosis: "diag-3" },
      ],
    });
    const result = await runEvolutionCycle({
      harnessPort: port,
      substrateId: SUBSTRATE_ID,
      canary: canaryTasks(repo.root),
      generations: 1,
      workspaceDir: repo.root,
    });
    expect(result.retainedMutants).toBeGreaterThanOrEqual(1);
    expect(result.committed).not.toBeNull();
    expect(result.committed!.sha.length).toBeGreaterThan(0);
    expect(result.canaryRelease?.decision).toBe("PROMOTE");
    expect(result.offline).toBe(false);
  });

  it("retains nothing on degrade (no commit/no release)", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("degrade"),
      substrates: { [SUBSTRATE_ID]: BASELINE_CONTENT },
      trajectories: [
        { id: "t1", sessionId: "t1", substrateSha: "x", failed: true, diagnosis: "d1" },
      ],
    });
    const result = await runEvolutionCycle({
      harnessPort: port,
      substrateId: SUBSTRATE_ID,
      canary: canaryTasks(repo.root),
      generations: 1,
      workspaceDir: repo.root,
    });
    expect(result.retainedMutants).toBe(0);
    expect(result.committed).toBeNull();
    expect(result.canaryRelease).toBeNull();
    expect(result.revertEvent).toBeNull();
  });

  it("auto-reverts on canary regression", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
      substrates: { [SUBSTRATE_ID]: BASELINE_CONTENT },
      trajectories: [
        { id: "t1", sessionId: "t1", substrateSha: "x", failed: true, diagnosis: "d1" },
      ],
    });
    // 注入退化 observations（resolveRateDrop 超阈值触发 AUTO_REVERT）。
    // 歧义记录：EvolveConfig 的 observations 注入字段 spec 未声明（见 ambiguities），
    // 此处按"canary 观测退化"契约假设 canaryObservations 字段。
    const result = await runEvolutionCycle({
      harnessPort: port,
      substrateId: SUBSTRATE_ID,
      canary: canaryTasks(repo.root),
      generations: 1,
      workspaceDir: repo.root,
      tau: { resolve_rate: 0 },
      canaryPolicy: {
        shadowPercent: 5,
        observationWindowTurns: 3,
        revertThresholds: {
          resolveRateDrop: 0.1,
          costRise: 0,
          piiCount: 0,
          paretoDominated: false,
        },
      },
      // @ts-expect-error — spec 未声明的 observations 注入通道（ambiguity）
      canaryObservations: [
        { resolveRate: 0.0, token: 0, cacheHit: 0, piiCount: 0 },
      ],
    } as Record<string, unknown>);
    expect(result.canaryRelease?.decision).toBe("AUTO_REVERT");
    expect(result.revertEvent?.decision).toBe("AUTO_REVERT");
    expect(result.postRevertResolveRate).toBe(result.baselineResolveRate);
  });

  it("offline mode skips readTrajectories", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
      substrates: { [SUBSTRATE_ID]: BASELINE_CONTENT },
      trajectories: [
        { id: "t1", sessionId: "t1", substrateSha: "x", failed: true, diagnosis: "d1" },
      ],
    });
    const result = await runEvolutionCycle({
      harnessPort: port,
      substrateId: SUBSTRATE_ID,
      canary: canaryTasks(repo.root),
      generations: 1,
      workspaceDir: repo.root,
      offline: true,
    });
    expect(port.readTrajectoriesCallCount).toBe(0);
    expect(result.offline).toBe(true);
  });

  it("throws InsufficientCanaryError when canary < 3", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
      substrates: { [SUBSTRATE_ID]: BASELINE_CONTENT },
    });
    await expect(
      runEvolutionCycle({
        harnessPort: port,
        substrateId: SUBSTRATE_ID,
        canary: canaryTasks(repo.root).slice(0, 2),
        workspaceDir: repo.root,
      }),
    ).rejects.toThrow(/insufficient.*canary|canary/i);
  });

  it("propagates SubstrateNotFoundError", async () => {
    const port = new FakeHarnessPort({
      repoRoot: repo.root,
      llmPort: new FakeLLM("improve"),
      substrates: {}, // substrateId 不存在
    });
    await expect(
      runEvolutionCycle({
        harnessPort: port,
        substrateId: "prompt/missing.md",
        canary: canaryTasks(repo.root),
        workspaceDir: repo.root,
      }),
    ).rejects.toBeInstanceOf(SubstrateNotFoundError);
  });
});

// 确认 git 可用（环境前置，非测试主体）
void execSync;
