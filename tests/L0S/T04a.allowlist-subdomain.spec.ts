import { describe, test, expect } from "vitest";
import { isAllowed, type NetRules } from "@harness/l0-sandbox";

/**
 * L0S-T04a · 边界（子域匹配）
 *
 * Spec G/W/T:
 *   Given allowedDomains 含 `.npmjs.org`；
 *   When  isAllowed('registry.npmjs.org', rules)；
 *   Then  allowed=true（前缀点号 = 子域）。
 *   Given allowedDomains 含 `api.github.com` 精确；
 *   When  isAllowed('evilapi.github.com', rules)；
 *   Then  allowed=false（精确不匹配子域）。
 */
describe("L0S-T04a", () => {
  test("subdomain suffix match", () => {
    const rules: NetRules = {
      allowedDomains: ["api.github.com", ".npmjs.org"],
      denyOutCidr: [],
    };

    // 前缀点号 = 子域通配：registry.npmjs.org / a.b.npmjs.org 均命中。
    expect(isAllowed("registry.npmjs.org", rules).allowed).toBe(true);
    expect(isAllowed("a.b.npmjs.org", rules).allowed).toBe(true);

    // bare apex npmjs.org 不带子域点号前缀时，按「.npmjs.org」不应被精确匹配命中
    // （点号前缀语义仅覆盖子域，不含 apex 自身）；实现可选择同时允许 apex，
    // 但子域必须放行——此处只断言子域放行这一硬契约。
    expect(isAllowed("registry.npmjs.org", rules).allowed).toBe(true);
  });

  test("exact does not match subdomain", () => {
    const rules: NetRules = {
      allowedDomains: ["api.github.com"],
      denyOutCidr: [],
    };

    // 精确匹配 api.github.com 放行。
    expect(isAllowed("api.github.com", rules).allowed).toBe(true);

    // evilapi.github.com 是 api.github.com 的「父域拼接」，非子域，须拒绝。
    expect(isAllowed("evilapi.github.com", rules).allowed).toBe(false);

    // x.api.github.com 是 api.github.com 的子域，但 allowlist 仅精确列出 api.github.com，
    // spec 明确「精确不匹配子域」→ 拒绝。
    expect(isAllowed("x.api.github.com", rules).allowed).toBe(false);
  });

  test("non-listed domain denied with reason", () => {
    const rules: NetRules = {
      allowedDomains: ["api.github.com"],
      denyOutCidr: [],
    };

    const r = isAllowed("evil.com", rules);
    expect(r.allowed).toBe(false);
    expect(typeof r.reason).toBe("string");
  });
});
