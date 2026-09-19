// CE-T04: fresh-context reviewer — 异模型族/异 session / 只读权威证据 / MAX_REVIEW_ITERATIONS=5
//
// 覆盖 spec（execution/canary-eval/TASKS.md §CE-T04）的 Given/When/Then 全部场景：
//   1. trajectory + 权威证据 + 异模型族 judge → modelFamily !== agentModelFamily + iterations<=5 + missing feed 回（正常路径）
//   2. input 含 nlSummary → throw NLSummaryForbiddenError（边界，只读权威证据不变量）
//   3. reviewer 与 agent 同模型族 → throw SameModelFamilyError（错误路径，self-preference）
//
// RED state: @harness/canary-eval 未实现 → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import {
  runFreshReviewer,
  NLSummaryForbiddenError,
  SameModelFamilyError,
  type ReviewerInput,
  type ReviewerOutput,
} from "@harness/canary-eval";

function mkInput(overrides?: Partial<ReviewerInput>): ReviewerInput {
  return {
    transcript: [] as unknown as ReviewerInput["transcript"],
    authoritativeEvidence: {
      files: ["src/a.ts"],
      commands: ["pnpm vitest run"],
      testResults: ["1 passed"],
    },
    ...overrides,
  } as ReviewerInput;
}

describe("CE-T04", () => {
  it("should use different model family and cap iterations at 5", async () => {
    const input = mkInput();
    const out: ReviewerOutput = await runFreshReviewer(input, {
      agentModelFamily: "anthropic",
      judgePool: ["openai/gpt-4o", "google/gemini-1.5-pro"],
    });

    expect(out.modelFamily).not.toBe("anthropic");
    expect(out.iterations).toBeLessThanOrEqual(5);
    expect(out.iterations).toBeGreaterThan(0);
    // missing 字段须 feed 回 agent loop（数组，可空）
    expect(Array.isArray(out.missing)).toBe(true);
    expect(typeof out.score).toBe("number");
  });

  it("should throw when nlSummary provided", () => {
    // 不变量：不读 NL summary —— 提供即违规
    const input = mkInput({
      nlSummary: "we think it passed" as unknown as undefined,
    } as Partial<ReviewerInput>);

    expect(() => runFreshReviewer(input, {
      agentModelFamily: "anthropic",
      judgePool: ["openai/gpt-4o"],
    })).toThrow(NLSummaryForbiddenError);
  });

  it("should throw on same model family", () => {
    // judge pool 全部与 agent 同模型族 → self-preference → throw
    const input = mkInput();
    expect(() => runFreshReviewer(input, {
      agentModelFamily: "anthropic",
      judgePool: ["anthropic/claude-3.5", "anthropic/claude-3"],
    })).toThrow(SameModelFamilyError);
  });
});
