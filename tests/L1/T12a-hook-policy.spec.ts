// L1-T12a · hook policy（PreToolUse 规则）基质 + breaker clause（bash/write deny→allow reject；silence≠approve）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T12a spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  HookPolicy,
  BreakerDenyToAllowError,
  SilenceApproveViolation,
  DENY_TO_ALLOW_FORBIDDEN,
  type HookRule,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const POLICY_YAML = `rules:
  - matcher: Bash
    ifPredicate: "command matches 'rm -rf'"
    decision: deny
    reason: destructive
    fallback: use safer command
  - matcher: Write
    decision: ask
    reason: confirm write
`;

function setup(root: string): RepoLock {
  mkdirSync(join(root, "hooks"), { recursive: true });
  writeFileSync(join(root, "hooks/policy.yaml"), POLICY_YAML, "utf8");
  return { versionSha: "i".repeat(40), files: [{ path: "hooks/policy.yaml", sha256: sha(POLICY_YAML) }] };
}

describe("L1-T12a", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t12a-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("load returns ordered rule set", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const policy = new HookPolicy({ repo });
    const rules = policy.load(repo);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]!.matcher).toBe("Bash");
    expect(rules[1]!.matcher).toBe("Write");
  });

  it("assertSilenceNotApprove treats exit0+no-stdout as fall-through", () => {
    const policy = new HookPolicy({} as never);
    // exit 0 + 无 stdout = fall-through（非 approve），不 throw，继续下一条规则
    expect(() => policy.assertSilenceNotApprove(0, "")).not.toThrow();
  });

  it("assertSilenceNotApprove throws when silence treated as approve", () => {
    const policy = new HookPolicy({} as never);
    // 当 caller 把 fall-through 当 approve → throw
    // 通过传入 treatedAsApprove=true 触发不变量
    expect(() => policy.assertSilenceNotApprove(0, "", true)).toThrowError(SilenceApproveViolation);
  });

  it("assertBreaker throws on bash deny→allow", () => {
    const policy = new HookPolicy({} as never);
    expect(DENY_TO_ALLOW_FORBIDDEN).toContain("bash");
    expect(() => policy.assertBreaker({ tool: "bash", from: "deny", to: "allow" })).toThrowError(BreakerDenyToAllowError);
  });

  it("assertBreaker throws on write deny→allow", () => {
    const policy = new HookPolicy({} as never);
    expect(DENY_TO_ALLOW_FORBIDDEN).toContain("write");
    expect(() => policy.assertBreaker({ tool: "write", from: "deny", to: "allow" })).toThrowError(BreakerDenyToAllowError);
  });

  it("assertBreaker allows ask→deny (tightening)", () => {
    const policy = new HookPolicy({} as never);
    // 收紧方向放行
    expect(() => policy.assertBreaker({ tool: "bash", from: "allow", to: "deny" })).not.toThrow();
    expect(() => policy.assertBreaker({ tool: "bash", from: "ask", to: "deny" })).not.toThrow();
    // 非 forbidden 工具的 deny→allow 放行
    expect(() => policy.assertBreaker({ tool: "read", from: "deny", to: "allow" })).not.toThrow();
  });
});
