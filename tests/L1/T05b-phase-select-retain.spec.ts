// L1-T05b · phase 进化 loop-b：select + cache warm-up 软多目标 + canary 配置面
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T05b spec 编写。
// 核心：cacheHitSteadyState=null（warm-up 未过）不冻结 phase 进化；稳态发散 reject。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  PhaseSelectRetain,
  type PhaseCandidateScore,
  type PhaseVariantCandidate,
} from "@harness/l1-config";
import {
  ConfigRepo,
  CanaryConfigPlane,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const SAFETY = "Never drop tool_use_id pairing.";
const CODING = `<identity>x</identity><safety>${SAFETY}</safety>coding`;

function setup(root: string): RepoLock {
  mkdirSync(join(root, "prompts"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  writeFileSync(join(root, "prompts/phase-coding.md"), CODING, "utf8");
  return { versionSha: "e".repeat(40), files: [{ path: "prompts/phase-coding.md", sha256: sha(CODING) }] };
}

function ps(o: Partial<PhaseCandidateScore>): PhaseCandidateScore {
  return {
    candidateId: o.candidateId ?? "c1",
    phase: o.phase ?? "coding",
    resolveRate: o.resolveRate ?? 0,
    sweRebenchGeneralization: o.sweRebenchGeneralization ?? 0,
    cacheHitSteadyState: o.cacheHitSteadyState ?? null,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T05b", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t05b-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const baseline = ps({ isBaseline: true, resolveRate: 0.48, sweRebenchGeneralization: 0.44, cacheHitSteadyState: 0.6 });

  it("select passes candidate with cacheHit null (warm-up not done)", () => {
    const sr = new PhaseSelectRetain({} as never);
    const cand = ps({ candidateId: "v1", resolveRate: 0.50, sweRebenchGeneralization: 0.45, cacheHitSteadyState: null });
    const selected = sr.select([cand], baseline, 0.02, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(true);
  });

  it("select passes candidate with steady cache loss < tauCache", () => {
    const sr = new PhaseSelectRetain({} as never);
    // 稳态 0.59 vs baseline 0.60 → loss 0.01 < 0.02
    const cand = ps({ candidateId: "v1", resolveRate: 0.50, sweRebenchGeneralization: 0.45, cacheHitSteadyState: 0.59 });
    const selected = sr.select([cand], baseline, 0.02, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(true);
  });

  it("select rejects candidate with steady cache loss > tauCache (divergence)", () => {
    const sr = new PhaseSelectRetain({} as never);
    // 稳态 0.50 vs baseline 0.60 → loss 0.10 > 0.02 发散
    const cand = ps({ candidateId: "v1", resolveRate: 0.50, sweRebenchGeneralization: 0.45, cacheHitSteadyState: 0.50 });
    const selected = sr.select([cand], baseline, 0.02, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(false);
  });

  it("select rejects candidate with resolve degrade >= tau", () => {
    const sr = new PhaseSelectRetain({} as never);
    // resolve 0.45 vs baseline 0.48 → 降 0.03 >= 0.02
    const cand = ps({ candidateId: "v1", resolveRate: 0.45, sweRebenchGeneralization: 0.45, cacheHitSteadyState: null });
    const selected = sr.select([cand], baseline, 0.02, 0.02);
    expect(selected.some((c) => c.candidateId === "v1")).toBe(false);
  });

  it("commitOnSuccess writes active + staging v2 + warmUpSessionId", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sr = new PhaseSelectRetain({ repo } as never);
    const candidate: PhaseVariantCandidate = {
      id: "pv-1",
      substrate: "phase",
      phase: "coding",
      parentSha: sha(CODING),
      content: CODING + "\n<!-- patch -->",
      provenance: { trajectoryId: "t1", mutatorSession: "mut-1", generatedAt: Date.now() },
    } as PhaseVariantCandidate;
    sr.commitOnSuccess(candidate, [baseline, ps({ candidateId: "pv-1", resolveRate: 0.50, sweRebenchGeneralization: 0.45, cacheHitSteadyState: null })]);
    expect(readFileSync(join(root, "prompts/phase-coding.md"), "utf8")).toContain("<!-- patch -->");
    expect(existsSync(join(root, "staging/phase-coding.v2.md"))).toBe(true);
    sr.enableShadowWithWarmUp(join(root, "staging/phase-coding.v2.md"), "warmup-session-xyz");
    const shadow = readFileSync(join(root, "config/canary-shadow.yaml"), "utf8");
    expect(shadow).toContain("warmup-session-xyz");
  });

  it("rollback restores phase active sha", () => {
    const lock = setup(root);
    const repo = new ConfigRepo(root, lock);
    const sr = new PhaseSelectRetain({ repo } as never);
    const canary = new CanaryConfigPlane({ repo } as never);
    const candidate: PhaseVariantCandidate = {
      id: "pv-2",
      substrate: "phase",
      phase: "coding",
      parentSha: sha(CODING),
      content: CODING + "\n<!-- v2 -->",
      provenance: { trajectoryId: "t1", mutatorSession: "mut-1", generatedAt: Date.now() },
    } as PhaseVariantCandidate;
    sr.commitOnSuccess(candidate, [baseline]);
    canary.rollback(join(root, "prompts/phase-coding.md"));
    expect(sha(readFileSync(join(root, "prompts/phase-coding.md"), "utf8"))).toBe(sha(CODING));
  });
});
