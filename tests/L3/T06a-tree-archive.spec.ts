// L3-T06a: DGM open-ended tree archive（interesting=非严格劣即入档；keep-all） [MVP]
//
// RED state: TreeArchive / ArchiveEntry / DuplicateArchiveEntry not exported
// → RED. Keep-all invariant: retire does not delete.
//
// Spec: execution/L3-engine/TASKS.md §L3-T06a.

import { describe, it, expect } from "vitest";
import { TreeArchive, DuplicateArchiveEntry } from "@harness/l3-engine";
import type { ArchiveEntry, Fitness } from "@harness/l3-engine";
import { makeArchiveEntry, makeFitness } from "./fixtures/factories";

describe("L3-T06a", () => {
  it("isInteresting: child non-strictly worse than parent (≥ one dim) → true", () => {
    const archive = new TreeArchive();
    const parent = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // child: resolve_rate up (≥) → non-strictly dominated = interesting
    const child = makeFitness({ resolve_rate: 0.6, token: 120, cache_hit: 0.4 });
    expect(archive.isInteresting(child, parent)).toBe(true);
  });

  it("isInteresting: child strictly worse in all dims → false (not interesting)", () => {
    const archive = new TreeArchive();
    const parent = makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 });
    // child strictly worse: resolve_rate down, token up (worse), cache_hit down
    const child = makeFitness({ resolve_rate: 0.4, token: 120, cache_hit: 0.4 });
    expect(archive.isInteresting(child, parent)).toBe(false);
  });

  it("insert non-strictly-dominated child → archived; rollback(history sha) returns entry", () => {
    const archive = new TreeArchive();
    const parent = makeArchiveEntry({
      sha: "sha-parent",
      parentSha: null,
      fitness: makeFitness({ resolve_rate: 0.5, token: 100, cache_hit: 0.5 }),
      generation: 0,
    });
    archive.insert(parent);
    const child: ArchiveEntry = makeArchiveEntry({
      sha: "sha-child",
      parentSha: "sha-parent",
      fitness: makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }),
      generation: 1,
    });
    archive.insert(child);
    // rollback returns the historical variant
    const got = archive.rollback("sha-child");
    expect(got.sha).toBe("sha-child");
    const gotParent = archive.rollback("sha-parent");
    expect(gotParent.sha).toBe("sha-parent");
  });

  it("retire(sha) does not reduce size() (never-auto-delete invariant)", () => {
    const archive = new TreeArchive();
    const e = makeArchiveEntry({ sha: "sha-x" });
    archive.insert(e);
    const before = archive.size();
    archive.retire("sha-x");
    expect(archive.size()).toBe(before);
    // entry still present, status retired
    const got = archive.rollback("sha-x");
    expect(got.status).toBe("retired");
  });

  it("duplicate sha insert → throws DuplicateArchiveEntry", () => {
    const archive = new TreeArchive();
    const e = makeArchiveEntry({ sha: "sha-dup" });
    archive.insert(e);
    const dup = makeArchiveEntry({ sha: "sha-dup" });
    expect(() => archive.insert(dup)).toThrow(DuplicateArchiveEntry);
  });

  it("queryNonDominated consistent with T05 Pareto front (reuse fixture)", () => {
    const archive = new TreeArchive();
    // insert parent + a strictly-dominated child + a non-dominated sibling
    archive.insert(
      makeArchiveEntry({
        sha: "p",
        fitness: makeFitness({ resolve_rate: 0.6, token: 100, cache_hit: 0.5 }),
      }),
    );
    archive.insert(
      makeArchiveEntry({
        sha: "q",
        parentSha: "p",
        fitness: makeFitness({ resolve_rate: 0.5, token: 80, cache_hit: 0.5 }),
      }),
    );
    const front = archive.queryNonDominated();
    const ids = front.map((e) => e.sha).sort();
    // p and q are mutually non-dominating → both in front
    expect(ids).toContain("p");
    expect(ids).toContain("q");
  });
});
