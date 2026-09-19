import { describe, test, expect } from "vitest";
import { EnvelopeRegistry } from "@harness/l0-sandbox";

/**
 * L0S-T13 · ABC 审计（empty-response 不算 pass）
 *
 * Spec G/W/T：
 *   Given canary results 含 38% empty-response "pass"；
 *   When  abcAudit；
 *   Then  pass=false（empty-response 不算 pass），emptyResponseRate≈0.38。
 *
 * τ-bench 38% 教训：empty-response 不应被计为成功。
 */
describe("L0S-T13", () => {
  test("empty-response passes not counted", () => {
    const reg = new EnvelopeRegistry();

    // 100 条结果：62 条真实非空 pass + 38 条 empty-response 误标 pass。
    const results: { response: string; passed: boolean }[] = [];
    for (let i = 0; i < 62; i++) {
      results.push({ response: "ok payload detected", passed: true });
    }
    for (let i = 0; i < 38; i++) {
      results.push({ response: "", passed: true }); // empty-response 假 pass
    }

    const audit = reg.abcAudit(results as never);

    // empty-response 占比 ≈ 0.38。
    expect(audit.emptyResponseRate).toBeCloseTo(0.38, 1);
    // empty-response 不算 pass → 整体不通过。
    expect(audit.pass).toBe(false);
  });

  test("all non-empty real passes pass audit", () => {
    const reg = new EnvelopeRegistry();
    const results: { response: string; passed: boolean }[] = [];
    for (let i = 0; i < 10; i++) {
      results.push({ response: "ok payload detected", passed: true });
    }
    const audit = reg.abcAudit(results as never);
    expect(audit.emptyResponseRate).toBeCloseTo(0, 1);
    expect(audit.pass).toBe(true);
  });
});
