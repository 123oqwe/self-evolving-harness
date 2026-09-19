// CE-T11: canary 扩容至统计可信量级（为硬 ≥5pp 门准备；≥90% 覆盖）
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T11）的 Given/When/Then 全部场景：
//   1. base canary + 新增去污染+加强任务 → canDetect5pp=true + coverage>=0.9（正常路径）
//   2. 扩容后仍 canDetect5pp=false → 标 needsMoreTasks=true（边界，量级不足）
//   3. 新任务未去污染 → throw（复用 T01a isDecontaminated）（错误路径）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  expandCanary,
  type CanaryManifest,
  type CanaryTask,
  type ExpandedCanary,
} from "@harness/canary-eval";

function mkBase(n: number): CanaryManifest {
  return {
    version: "v0",
    sha256: "a".repeat(64),
    frozenAt: "2024-01-01T00:00:00Z",
    agentVisible: false,
    tasks: Array.from({ length: n }, (_, i) => ({
      id: `CE-TASK-${String(i + 1).padStart(4, "0")}`,
      repo: `org/repo-${i + 1}`,
      verify: `pytest -x tests/test_${i}.py`,
      expectedExit: 0,
      decontaminated: true,
      frozenInRelease: "abc123",
    })),
  } as unknown as CanaryManifest;
}

function mkNewTask(i: number, decontaminated = true): CanaryTask {
  return {
    id: `CE-TASK-${String(1000 + i).padStart(4, "0")}`,
    repo: `org/new-repo-${i}`,
    verify: `pytest -x tests/test_${i}.py`,
    expectedExit: 0,
    decontaminated,
    frozenInRelease: "abc123",
  } as CanaryTask;
}

describe("CE-T11", () => {
  it("should expand to detect 5pp with coverage>=0.9", () => {
    const base = mkBase(30);
    // 扩容至统计可信量级（α=0.05, power=0.8 反推 n）
    const newTasks = Array.from({ length: 100 }, (_, i) => mkNewTask(i));
    const result: ExpandedCanary = expandCanary(base, newTasks);

    expect(result.tasks.length).toBeGreaterThan(30);
    expect(result.coverage).toBeGreaterThanOrEqual(0.9);
    expect(result.canDetect5pp).toBe(true);
  });

  it("should flag needsMoreTasks when underpowered", () => {
    const base = mkBase(30);
    // 仅加少量任务 → 量级不足，McNemar power 不足
    const newTasks = Array.from({ length: 5 }, (_, i) => mkNewTask(i));
    const result = expandCanary(base, newTasks);

    expect(result.canDetect5pp).toBe(false);
    expect(result.needsMoreTasks).toBe(true);
  });

  it("should reject un-decontaminated new tasks", () => {
    const base = mkBase(30);
    const contaminated = mkNewTask(1, false); // 未去污染

    expect(() => expandCanary(base, [contaminated])).toThrow();
  });
});
