// L1-T11 · CLAUDE.md/steering patch 基质（ExpeL insight 驱动；人审每 diff）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T11 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SteeringPatch,
  UnapprovedSteeringPatchError,
  type SteeringPatchCandidate,
  type ExpeLInsight,
} from "@harness/l1-config";

function setup(root: string) {
  mkdirSync(join(root, ".kiro/steering"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# Project\n\nRules here.\n", "utf8");
  writeFileSync(join(root, ".kiro/steering/product.md"), "# Product\n", "utf8");
}

describe("L1-T11", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t11-"));
    setup(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("generateCandidates produces pending-approval patches", async () => {
    const sp = new SteeringPatch({ repoRoot: root });
    const insights: ExpeLInsight[] = [
      { clusterId: "c1", insightId: "i1", summary: "agent repeatedly forgets to run tests", severity: 0.8 },
    ] as ExpeLInsight[];
    const candidates = await sp.generateCandidates(insights);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.humanApproval).toBe("pending");
      expect(c.patch).toBeTruthy();
      expect(c.insightProvenance.clusterId).toBe("c1");
    }
  });

  it("assertHumanApproval throws on unapproved patch", () => {
    const sp = new SteeringPatch({ repoRoot: root });
    const candidate: SteeringPatchCandidate = {
      id: "p1",
      filePath: "CLAUDE.md",
      patch: "+ run tests before commit",
      insightProvenance: { clusterId: "c1", insightId: "i1" },
      humanApproval: "pending",
    };
    expect(() => sp.assertHumanApproval(candidate)).toThrowError(UnapprovedSteeringPatchError);
    // rejected 同样 throw
    const rejected = { ...candidate, humanApproval: "rejected" as const };
    expect(() => sp.assertHumanApproval(rejected)).toThrowError(UnapprovedSteeringPatchError);
  });

  it("assertDecontaminated throws on canary reverse-degrade", () => {
    const sp = new SteeringPatch({ repoRoot: root });
    const candidate: SteeringPatchCandidate = {
      id: "p1",
      filePath: "CLAUDE.md",
      patch: "+ hint",
      insightProvenance: { clusterId: "c1", insightId: "i1" },
      humanApproval: "approved",
    };
    // resolveRate 降（疑似 memorize SWE-bench）→ throw
    expect(() => sp.assertDecontaminated(candidate, { resolveRate: 0.4, decontaminated: false })).toThrow();
    // resolveRate 不降 + decontaminated → 不 throw
    expect(() => sp.assertDecontaminated(candidate, { resolveRate: 0.6, decontaminated: true })).not.toThrow();
  });

  it("patch reversing scope order (user overrides project) rejected", () => {
    const sp = new SteeringPatch({ repoRoot: root });
    // 模拟 scope 顺序被 patch 改（user 覆盖 project）
    const candidate: SteeringPatchCandidate = {
      id: "p1",
      filePath: "CLAUDE.md",
      patch: "- project scope\n+ user scope overrides project",
      insightProvenance: { clusterId: "c1", insightId: "i1" },
      humanApproval: "approved",
    };
    expect(() => sp.commit?.(candidate)).toThrow();
    // 也可通过 evolve 流程验证：approved + decontaminated 但 scope 改 → reject
  });

  it("approved + decontaminated → commit writes CLAUDE.md + staging suffix", () => {
    const sp = new SteeringPatch({ repoRoot: root });
    const candidate: SteeringPatchCandidate = {
      id: "p1",
      filePath: "CLAUDE.md",
      patch: "+ Always run `pnpm test` before declaring done.\n",
      insightProvenance: { clusterId: "c1", insightId: "i1" },
      humanApproval: "approved",
    };
    sp.assertHumanApproval(candidate);
    sp.assertDecontaminated(candidate, { resolveRate: 0.6, decontaminated: true });
    sp.commit(candidate);
    const content = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(content).toContain("pnpm test");
    // staging 版本后缀存在
    expect(existsSync(join(root, "staging/CLAUDE.v2.md"))).toBe(true);
  });
});
