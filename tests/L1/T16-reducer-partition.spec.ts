// L1-T16 · reducer 表 + partition 策略进化（barrier await+tool_use_id static-core；custom_lua 沙箱；partition 不重叠）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T16 spec 编写。

import { describe, it, expect } from "vitest";
import {
  ReducerPartition,
  LuaSandboxEscapeError,
  PartitionOverlapError,
  type ReducerEntry,
  type ReducerScore,
} from "@harness/l1-config";

function rscore(o: Partial<ReducerScore>): ReducerScore {
  return {
    mergeConsistency: o.mergeConsistency ?? 0.9,
    partitionDisjointRate: o.partitionDisjointRate ?? 1.0,
    acceptance: o.acceptance ?? 0.5,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T16", () => {
  it("evolve changes overwrite→dedup_by_id on parallel-write signal", () => {
    const e = new ReducerPartition();
    const reducers: ReducerEntry[] = [{ stateKey: "messages", mergeOp: "overwrite" }];
    // 「并行写覆盖」信号 → mergeConsistency 低
    const scores: ReducerScore[] = [rscore({ mergeConsistency: 0.5 })];
    const evolved = e.evolve(reducers, "hash", scores);
    const msg = evolved.reducers.find((r) => r.stateKey === "messages");
    expect(msg).toBeDefined();
    expect(msg!.mergeOp).not.toBe("overwrite");
  });

  it("assertLuaSandboxed throws on os.execute", () => {
    const e = new ReducerPartition();
    expect(() => e.assertLuaSandboxed("os.execute('rm -rf /')")).toThrowError(LuaSandboxEscapeError);
  });

  it("assertLuaSandboxed throws on io.open", () => {
    const e = new ReducerPartition();
    expect(() => e.assertLuaSandboxed("local f = io.open('/etc/passwd')")).toThrowError(LuaSandboxEscapeError);
  });

  it("assertPartitionDisjoint throws on overlap", () => {
    const e = new ReducerPartition();
    // 交集非空（3 child 查同一子查询）
    const partitions = [["a", "b"], ["b", "c"], ["c", "d"]];
    expect(() => e.assertPartitionDisjoint(partitions)).toThrowError(PartitionOverlapError);
    // 不重叠不 throw
    expect(() => e.assertPartitionDisjoint([["a"], ["b"], ["c"]])).not.toThrow();
  });

  it("strict-improvement: consistency↑ ∧ disjoint↑ → 入选", () => {
    const e = new ReducerPartition();
    const baseline = rscore({ isBaseline: true, mergeConsistency: 0.8, partitionDisjointRate: 0.9, acceptance: 0.5 });
    const cand = rscore({ mergeConsistency: 0.95, partitionDisjointRate: 1.0, acceptance: 0.55 });
    const reducers: ReducerEntry[] = [{ stateKey: "messages", mergeOp: "append" }];
    const evolved = e.evolve(reducers, "hash", [baseline, cand]);
    expect(evolved.reducers.length).toBeGreaterThan(0);
  });
});
