// ISS-07: mine ↔ canary 去污染检查 (assertNoCanaryLeak)。
import { describe, it, expect } from "vitest";
import { assertNoCanaryLeak, ContaminationError } from "@harness/canary-eval";

describe("ISS-07 · assertNoCanaryLeak", () => {
  it("轨迹引用 canary taskId → throw ContaminationError", () => {
    expect(() =>
      assertNoCanaryLeak(
        [{ id: "sess-1", diagnosis: "参考 CE-TASK-0001 的解法" }],
        [{ id: "CE-TASK-0001", verify: "pnpm vitest run x" }],
      ),
    ).toThrow(ContaminationError);
  });

  it("轨迹文本与 canary verify 高重叠 → throw ContaminationError", () => {
    const verify = "pnpm vitest run tests/L0C/T02-turn.spec.ts";
    expect(() =>
      assertNoCanaryLeak(
        [{ id: "sess-2", diagnosis: `我发现 pnpm vitest run tests/L0C/T02-turn.spec.ts 这命令有问题` }],
        [{ id: "CE-TASK-0002", verify }],
      ),
    ).toThrow(ContaminationError);
  });

  it("无重叠 → 不 throw", () => {
    expect(() =>
      assertNoCanaryLeak(
        [{ id: "sess-3", diagnosis: "compaction 丢失未解决 bug" }],
        [{ id: "CE-TASK-0003", verify: "pnpm vitest run tests/L0C/T03-stop.spec.ts" }],
      ),
    ).not.toThrow();
  });
});
