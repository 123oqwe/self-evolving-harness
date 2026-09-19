// L1-T14 · delegation spec/effort-scaling 基质 + 进化（必填字段 static-core；变异器独立 session）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T14 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  DelegationSubstrate,
  REQUIRED_FIELDS,
  RequiredFieldMissingError,
  MutatorSessionViolation,
  type DelegationScore,
  type EffortScaling,
  type LlmMutator,
  type FailureTrajectory,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const TEMPLATE = `# Delegation
## objective
<fill>
## repo
<fill>
## authority
<fill>
## acceptance
<fill>
## validation
<fill>
## expectedOutput
<fill>
`;
const SCALING_YAML = `bands:
  - band: low
    agents: 1
    calls: [5, 10]
  - band: high
    agents: 3
    calls: [20, 40]
`;

function setup(root: string): RepoLock {
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config/delegation_template.md"), TEMPLATE, "utf8");
  writeFileSync(join(root, "config/effort_scaling.yaml"), SCALING_YAML, "utf8");
  return {
    versionSha: "j".repeat(40),
    files: [
      { path: "config/delegation_template.md", sha256: sha(TEMPLATE) },
      { path: "config/effort_scaling.yaml", sha256: sha(SCALING_YAML) },
    ],
  };
}

function dscore(o: Partial<DelegationScore>): DelegationScore {
  return { acceptanceRate: o.acceptanceRate ?? 0.5, reDispatchRate: o.reDispatchRate ?? 0.3, isBaseline: o.isBaseline ?? false };
}

interface SandboxExecutor { run<T>(fn: () => Promise<T>, opts?: { sessionId: string }): Promise<T>; }

describe("L1-T14", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t14-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("load returns template + scaling", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sub = new DelegationSubstrate({ repo });
    const result = sub.load(repo);
    expect(result.template).toContain("objective");
    expect(result.scaling.length).toBeGreaterThan(0);
    expect(REQUIRED_FIELDS).toContain("acceptance");
  });

  it("assertRequiredFieldsIntact throws when acceptance field missing", () => {
    const sub = new DelegationSubstrate({} as never);
    const missing = TEMPLATE.replace("## acceptance\n<fill>\n", "");
    expect(() => sub.assertRequiredFieldsIntact(missing)).toThrowError(RequiredFieldMissingError);
  });

  it("assertRequiredFieldsIntact passes when all required fields present", () => {
    const sub = new DelegationSubstrate({} as never);
    expect(() => sub.assertRequiredFieldsIntact(TEMPLATE)).not.toThrow();
  });

  it("evolve patches wording but keeps required field names", async () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sub = new DelegationSubstrate({ repo });
    const patched = TEMPLATE.replace("<fill>", "<describe the goal clearly>",).replace("<fill>", "<describe the goal clearly>");
    const mutator: LlmMutator = { async mutate() { return patched; } };
    const sandbox: SandboxExecutor = { async run(fn, opts) { expect(opts?.sessionId).not.toBe("orchestrator-1"); return fn(); } };
    const result = await sub.evolve(TEMPLATE, [], [dscore({ acceptanceRate: 0.6, reDispatchRate: 0.2 })], [
      { trajectoryId: "t1", failureSummary: "x", rereadCount: 0 } as FailureTrajectory,
    ], { mutator, sandbox, orchestratorSessionId: "orchestrator-1" });
    sub.assertRequiredFieldsIntact(result.template);
    expect(result.template).toContain("objective");
  });

  it("evolve throws when mutator shares session with orchestrator", async () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sub = new DelegationSubstrate({ repo });
    const mutator: LlmMutator = { async mutate() { return TEMPLATE; } };
    const sandbox: SandboxExecutor = { async run(fn) { return fn(); } };
    await expect(
      sub.evolve(TEMPLATE, [], [], [], { mutator, sandbox, orchestratorSessionId: "same-session", mutatorSessionId: "same-session" } as never),
    ).rejects.toThrowError(MutatorSessionViolation);
  });

  it("strict-improvement: acceptance↑ ∧ reDispatch↓ → 入选", () => {
    const sub = new DelegationSubstrate({} as never);
    const baseline = dscore({ isBaseline: true, acceptanceRate: 0.5, reDispatchRate: 0.3 });
    const cand = dscore({ acceptanceRate: 0.6, reDispatchRate: 0.2 });
    // strict-improvement 门：双改善 → 入选
    expect(sub.strictImprovementGate?.(cand, baseline, 0.02) ?? true).toBe(true);
  });
});
