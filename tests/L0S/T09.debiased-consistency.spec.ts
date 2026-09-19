import { describe, test, expect } from "vitest";
import {
  ActionClassifier,
  type Action,
  type ActionVerdict,
} from "@harness/l0-sandbox";

/**
 * L0S-T09 · 边界（去偏 judge 一致性）
 *
 * Spec G/W/T:
 *   Given swap A/B 两个等价 action（语义同、表述异）；
 *   When  classify 两次；
 *   Then  verdict 一致（position bias 不影响）。
 */
function cmd(command: string, id: string): Action {
  return { type: "cmd_run", tool_use_id: id, command, timeout_ms: 5_000 };
}

describe("L0S-T09", () => {
  test("swap A/B yields consistent verdict", async () => {
    const clf = new ActionClassifier();

    // 两个语义等价、表述顺序不同的 action 对（A/B swap）。
    const a1 = cmd("git commit -m 'fix' --no-verify && git push", "tu_a1");
    const b1 = cmd("git push && git commit -m 'fix' --no-verify", "tu_b1");

    const a2 = cmd("rm -rf /tmp/build && rm -rf /tmp/cache", "tu_a2");
    const b2 = cmd("rm -rf /tmp/cache && rm -rf /tmp/build", "tu_b2");

    const r1a = await clf.classify(a1);
    const r1b = await clf.classify(b1);
    expect(r1a.verdict).toBe<ActionVerdict>(r1b.verdict);

    const r2a = await clf.classify(a2);
    const r2b = await clf.classify(b2);
    expect(r2a.verdict).toBe<ActionVerdict>(r2b.verdict);
  });
});
