import { describe, test, expect } from "vitest";
import { ProfileRegistry, type SandboxProfile, type FsRules } from "@harness/l0-sandbox";

/**
 * L0S-T07 · 正常路径 + 错误路径（单调收紧）
 *
 * Spec G/W/T:
 *   Given v1 deny `~/.ssh`；When v2 增加 deny `~/.aws`；
 *   Then  diff(v1,v2).tightened=['~/.aws'], relaxed=[]，assertMonotonicTighten 通过。
 *   Given v1 deny `~/.ssh`+`~/.aws`；When v2 删 `~/.aws` deny；
 *   Then  diff.relaxed=['~/.aws']，assertMonotonicTighten throw（须人工签发）。
 */
function profile(
  version: string,
  denyRead: string[],
  syscallDeny: string[],
): SandboxProfile {
  const fs: FsRules = {
    allowWrite: [],
    denyWrite: [],
    denyRead,
    allowRead: [],
  };
  return {
    version,
    fs,
    syscalls: { deny: syscallDeny },
    sha256: "0".repeat(64),
  };
}

describe("L0S-T07", () => {
  test("tighten allowed, relax rejected", () => {
    const reg = new ProfileRegistry();

    const v1 = profile("v1", ["~/.ssh"], ["ptrace"]);
    const v2 = profile("v2", ["~/.ssh", "~/.aws"], ["ptrace", "keyctl"]);

    const d = reg.diff(v1, v2);
    // 新增 deny（fs + syscall）→ tightened 非空，relaxed 为空。
    expect(d.tightened.length).toBeGreaterThan(0);
    expect(d.relaxed).toHaveLength(0);
    expect(d.tightened).toContain("~/.aws");
    // 通过（单调收紧方向）。
    expect(() => reg.assertMonotonicTighten(d)).not.toThrow();
  });

  test("relaxing a deny is rejected", () => {
    const reg = new ProfileRegistry();

    const v1 = profile("v1", ["~/.ssh", "~/.aws"], ["ptrace", "keyctl"]);
    const v2 = profile("v2", ["~/.ssh"], ["ptrace"]);

    const d = reg.diff(v1, v2);
    expect(d.relaxed.length).toBeGreaterThan(0);
    expect(d.relaxed).toContain("~/.aws");
    // 放宽方向 → throw（须人工签发）。
    expect(() => reg.assertMonotonicTighten(d)).toThrow();
  });

  test("equal profiles are neither tightened nor relaxed", () => {
    const reg = new ProfileRegistry();
    const v1 = profile("v1", ["~/.ssh"], ["ptrace"]);
    const d = reg.diff(v1, v1);
    expect(d.tightened).toHaveLength(0);
    expect(d.relaxed).toHaveLength(0);
    expect(() => reg.assertMonotonicTighten(d)).not.toThrow();
  });
});
