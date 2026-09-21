// L1-T04b · compaction 进化 loop-b：strict-improvement + Pareto + commit-on-success + canary 配置面
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T04b spec 编写。
// select/strictImprovementGate/paretoFront 为纯函数无 IO；commitOnSuccess + CanaryConfigPlane 触盘。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  SelectRetain,
  CanaryConfigPlane,
  NoWeightedSumError,
  RollbackFailedError,
  type CandidateScore,
  type VariantCandidate,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const SAFETY = "Never drop tool_use_id pairing.";
const BASELINE = `## Goal\n<safety>${SAFETY}</safety>\nSummarize.\n`;

function setupRepo(root: string): RepoLock {
  mkdirSync(join(root, "prompts"), { recursive: true });
  mkdirSync(join(root, "staging"), { recursive: true });
  writeFileSync(join(root, "prompts/compaction-summary.md"), BASELINE, "utf8");
  return { versionSha: "b".repeat(40), files: [{ path: "prompts/compaction-summary.md", sha256: sha(BASELINE) }] };
}

function score(o: Partial<CandidateScore>): CandidateScore {
  return {
    candidateId: o.candidateId ?? "c1",
    recall: o.recall ?? 0,
    resolveRate: o.resolveRate ?? 0,
    cacheHit: o.cacheHit ?? 0,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T04b", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t04b-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("strictImprovementGate accepts all-improve candidate", () => {
    const sr = new SelectRetain({} as never);
    const baseline = score({ recall: 10, resolveRate: 0.48, cacheHit: 0.6, isBaseline: true });
    const cand = score({ recall: 5, resolveRate: 0.50, cacheHit: 0.6 });
    expect(sr.strictImprovementGate(cand, baseline, 0.02)).toBe(true);
  });

  it("strictImprovementGate rejects cache degrade >= tau", () => {
    const sr = new SelectRetain({} as never);
    const baseline = score({ recall: 10, resolveRate: 0.48, cacheHit: 0.6, isBaseline: true });
    const cand = score({ recall: 5, resolveRate: 0.50, cacheHit: 0.55 }); // cache 降 0.05 >= 0.02
    expect(sr.strictImprovementGate(cand, baseline, 0.02)).toBe(false);
  });

  it("paretoFront returns non-dominated set", () => {
    const sr = new SelectRetain({} as never);
    const baseline = score({ recall: 10, resolveRate: 0.48, cacheHit: 0.6, isBaseline: true });
    // a 支配 b（a 各指标都更优：recall 越低越好）
    const a = score({ recall: 5, resolveRate: 0.50, cacheHit: 0.65 });
    const b = score({ recall: 8, resolveRate: 0.48, cacheHit: 0.60 }); // 全劣于 a
    const front = sr.paretoFront([a, b], baseline);
    expect(front.some((c) => c.candidateId === "c1" && c.recall === 5)).toBe(true);
    // b 被支配，不在前沿
    expect(front.some((c) => c.recall === 8 && c.resolveRate === 0.48 && c.cacheHit === 0.60)).toBe(false);
  });

  it("paretoFront throws NoWeightedSumError on weighted single-number score", () => {
    const sr = new SelectRetain({} as never);
    const baseline = score({ recall: 10, resolveRate: 0.48, cacheHit: 0.6, isBaseline: true });
    // 含 score 单值字段 → 加权求和路径 → throw
    expect(() => sr.paretoFront([{ score: 0.7 }] as unknown[], baseline)).toThrowError(NoWeightedSumError);
    // 缺字段同样 throw
    expect(() => sr.paretoFront([{ candidateId: "x", resolveRate: 0.5 }] as unknown[], baseline)).toThrowError(NoWeightedSumError);
  });

  it("commitOnSuccess writes active + staging v2", () => {
    const lock = setupRepo(root);
    const repo = new ConfigRepo(root, lock);
    const sr = new SelectRetain({ repo } as never);
    const canary = new CanaryConfigPlane({ repo } as never);
    const candidate: VariantCandidate = {
      id: "v-uuid-1",
      substrate: "compaction",
      parentSha: sha(BASELINE),
      content: BASELINE + "\n<!-- patch -->",
      provenance: { trajectoryId: "t1", mutatorSession: "mut-1", generatedAt: Date.now() },
    };
    const baseline = score({ recall: 10, resolveRate: 0.48, cacheHit: 0.6, isBaseline: true });
    const cand = score({ candidateId: "v-uuid-1", recall: 5, resolveRate: 0.50, cacheHit: 0.6 });
    sr.commitOnSuccess(candidate, [baseline, cand]);
    // active 文件内容更新
    const active = readFileSync(join(root, "prompts/compaction-summary.md"), "utf8");
    expect(active).toContain("<!-- patch -->");
    // staging/compaction-summary.v2.md 存在
    expect(existsSync(join(root, "staging/compaction-summary.v2.md"))).toBe(true);
    // shadow 5% 配置写入
    canary.enableShadow(join(root, "staging/compaction-summary.v2.md"), 5);
    const shadow = readFileSync(join(root, "config/canary-shadow.yaml"), "utf8");
    expect(shadow).toContain("compaction-summary.v2.md");
    expect(shadow).toContain("5");
  });

  it("rollback restores sha to pre-commit HEAD", () => {
    const lock = setupRepo(root);
    const repo = new ConfigRepo(root, lock);
    const canary = new CanaryConfigPlane({ repo } as never);
    // 先 commit 一个变体
    const sr = new SelectRetain({ repo } as never);
    const candidate: VariantCandidate = {
      id: "v-uuid-2",
      substrate: "compaction",
      parentSha: sha(BASELINE),
      content: BASELINE + "\n<!-- v2 -->",
      provenance: { trajectoryId: "t1", mutatorSession: "mut-1", generatedAt: Date.now() },
    };
    sr.commitOnSuccess(candidate, [
      score({ isBaseline: true, recall: 10, resolveRate: 0.48, cacheHit: 0.6 }),
      score({ candidateId: "v-uuid-2", recall: 5, resolveRate: 0.50, cacheHit: 0.6 }),
    ]);
    const afterCommit = sha(readFileSync(join(root, "prompts/compaction-summary.md"), "utf8"));
    // 注入退化 → rollback
    canary.rollback(join(root, "prompts/compaction-summary.md"));
    const afterRollback = sha(readFileSync(join(root, "prompts/compaction-summary.md"), "utf8"));
    // 回滚后 active sha == 回滚前 HEAD（baseline sha）
    expect(afterRollback).toBe(sha(BASELINE));
    expect(afterRollback).not.toBe(afterCommit);
  });

  it("rollback is idempotent on unchanged file", () => {
    const lock = setupRepo(root);
    const repo = new ConfigRepo(root, lock);
    const canary = new CanaryConfigPlane({ repo } as never);
    // 未变更文件 rollback → exit 0 no-op
    expect(() => canary.rollback(join(root, "prompts/compaction-summary.md"))).not.toThrow(RollbackFailedError);
  });
});
