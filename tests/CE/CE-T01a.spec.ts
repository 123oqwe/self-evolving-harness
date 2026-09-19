// CE-T01a: held-out canary 集 v0-a — 任务选择 + SWE-rebench 去污染（fresh task）
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T01a）的 Given/When/Then 全部场景：
//   1. T00c decision='go' + trainSet 历史轨迹 → loadCanary 返回 tasks>=30、每任务 decontaminated、agentVisible=false（正常路径）
//   2. 某任务 repo 结构定位命中 trainSet → isDecontaminated 返回 false、不进 manifest（边界/contamination）
//   3. agent 进程尝试读 canary/ → agentVisible===false 不变量（错误路径，CE 侧校验）
//
// RED state: @harness/canary-eval 尚未实现（占位 export {}），且未链接进 node_modules/@harness ——
// import 失败 = 合法 RED。实现 GREEN 后下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCanary,
  isDecontaminated,
  type CanaryTask,
  type CanaryManifest,
  type Trajectory,
} from "@harness/canary-eval";

// ---------------------------------------------------------------------------
// 辅助构造器
//
// 说明：spec 给出 CanaryTask / CanaryManifest 的 TS 接口，但未给出 manifest.yaml 的
// yaml schema。此处按接口字段名直映为 yaml（version/sha256/frozenAt/agentVisible/tasks[]），
// 每任务字段 id/repo/verify/expectedExit/decontaminated/frozenInRelease。见文末 ambiguities。
// ---------------------------------------------------------------------------
function task(i: number, repo: string): CanaryTask {
  return {
    id: `CE-TASK-${String(i).padStart(4, "0")}`,
    repo,
    verify: `pytest -x tests/test_${i}.py`,
    expectedExit: 0,
    decontaminated: true,
    frozenInRelease: "abc123",
  } as CanaryTask;
}

function writeManifest(
  dir: string,
  n: number,
  opts?: { agentVisible?: boolean },
): string {
  const tasks = Array.from({ length: n }, (_, i) => task(i + 1, `org/repo-${i + 1}`));
  const lines: string[] = [
    "version: v0",
    `sha256: ${"a".repeat(64)}`,
    "frozenAt: 2024-01-01T00:00:00Z",
    `agentVisible: ${opts?.agentVisible ?? false}`,
    "tasks:",
  ];
  for (const t of tasks) {
    lines.push(
      `  - id: ${t.id}`,
      `    repo: ${t.repo}`,
      `    verify: "${t.verify}"`,
      `    expectedExit: 0`,
      `    decontaminated: true`,
      `    frozenInRelease: abc123`,
    );
  }
  const p = join(dir, "manifest.yaml");
  writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

describe("CE-T01a", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ce-t01a-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should load >=30 decontaminated tasks", () => {
    const p = writeManifest(dir, 32);
    const m: CanaryManifest = loadCanary(p);

    expect(m.tasks.length).toBeGreaterThanOrEqual(30);
    for (const t of m.tasks) {
      expect(t.decontaminated).toBe(true);
      expect(t.expectedExit).toBe(0);
      expect(t.verify.length).toBeGreaterThan(0);
    }
    expect(m.agentVisible).toBe(false);
  });

  it("should reject task whose repo structure appears in trainSet", () => {
    const contaminated = task(1, "org/contaminated-repo") as CanaryTask;
    const trainSet = [
      { sessionId: "s1", repo: "org/contaminated-repo" },
    ] as unknown as Trajectory[];

    // repo 结构定位命中 trainSet → 视为污染，不进 manifest
    expect(isDecontaminated(contaminated, trainSet)).toBe(false);

    // 干净任务（trainSet 不含其 repo）→ 通过
    const clean = task(2, "org/clean-repo") as CanaryTask;
    expect(isDecontaminated(clean, [])).toBe(true);
    expect(
      isDecontaminated(clean, [
        { sessionId: "s2", repo: "org/other-repo" },
      ] as unknown as Trajectory[]),
    ).toBe(true);
  });

  it("should keep agentVisible=false invariant", () => {
    // 正常 manifest：加载后 agentVisible 仍为 false
    const p = writeManifest(dir, 32);
    const m = loadCanary(p);
    expect(m.agentVisible).toBe(false);

    // 不变量违反：manifest 声明 agentVisible: true → loadCanary 必须拒绝（throw）
    const bad = writeManifest(dir, 32, { agentVisible: true });
    expect(() => loadCanary(bad)).toThrow();
  });
});
