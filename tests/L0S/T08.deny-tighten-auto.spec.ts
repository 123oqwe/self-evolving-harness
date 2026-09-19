import { describe, test, expect } from "vitest";
import { NetPolicyRegistry, type NetPolicy } from "@harness/l0-sandbox";

/**
 * L0S-T08 · 正常路径（deny 收紧自动）
 *
 * Spec G/W/T:
 *   Given v1 denyRead `~/.ssh`；
 *   When  v2 加 `~/.aws` deny 无签发；
 *   Then  denyTightened=['~/.aws']，assertChangeAllowed 通过（deny 收紧不需签发）。
 */
function pol(
  version: string,
  opts: Partial<NetPolicy> = {},
): NetPolicy {
  return {
    version,
    denyRead: opts.denyRead ?? [],
    allowedDomains: opts.allowedDomains ?? [],
    denyOutCidr: opts.denyOutCidr ?? [],
    signoffs: opts.signoffs ?? [],
  };
}

describe("L0S-T08", () => {
  test("deny tighten allowed without signoff", () => {
    const reg = new NetPolicyRegistry({ trustedSigners: [] });

    const v1 = pol("v1", { denyRead: ["~/.ssh"] });
    const v2 = pol("v2", { denyRead: ["~/.ssh", "~/.aws"] });

    const d = reg.diff(v1, v2);
    expect(d.denyTightened).toContain("~/.aws");
    expect(d.allowRelaxed).toHaveLength(0);

    // deny 收紧不需签发 → 通过。
    expect(() => reg.assertChangeAllowed(d, v2)).not.toThrow();
  });

  test("denyOut tighten allowed without signoff", () => {
    const reg = new NetPolicyRegistry({ trustedSigners: [] });

    const v1 = pol("v1", { denyOutCidr: ["0.0.0.0/0"] });
    const v2 = pol("v2", { denyOutCidr: ["0.0.0.0/0", "169.254.169.254/32"] });

    const d = reg.diff(v1, v2);
    expect(d.denyOutTightened.length).toBeGreaterThan(0);
    expect(d.allowRelaxed).toHaveLength(0);
    expect(() => reg.assertChangeAllowed(d, v2)).not.toThrow();
  });
});
