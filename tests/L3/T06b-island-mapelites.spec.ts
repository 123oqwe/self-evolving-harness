// L3-T06b: FunSearch island reseed + MAP-Elites behavior bins [MVP]
//
// RED state: IslandArchive / MapElitesArchive not exported → RED. Invariants:
// reseed "kill" = retired (not delete); global size never decreases.
//
// Spec: execution/L3-engine/TASKS.md §L3-T06b.

import { describe, it, expect } from "vitest";
import { IslandArchive, MapElitesArchive } from "@harness/l3-engine";
import type { ArchiveEntry } from "@harness/l3-engine";
import { makeArchiveEntry, makeFitness } from "./fixtures/factories";

describe("L3-T06b", () => {
  // =========================================================================
  // IslandArchive — FunSearch periodic reseed
  // =========================================================================
  it("reseed at period: each island kills worst-half; survivors reseed from best (seed-fixed ids)", () => {
    const archive = new IslandArchive({
      islandCount: 4,
      reseedPeriod: 2,
      prngSeed: 42,
    });
    // 8 entries, deterministic fitness — half will be killed at reseed
    const entries: ArchiveEntry[] = [];
    for (let i = 0; i < 8; i++) {
      const e = makeArchiveEntry({
        sha: `s-${i}`,
        fitness: makeFitness({ resolve_rate: 0.1 * i, token: 100, cache_hit: 0.5 }),
      });
      entries.push(e);
      archive.insert(e);
    }
    const result = archive.reseed(2); // period reached
    // worst-half killed (retired), survivors reseeded
    expect(result.killed.length).toBeGreaterThan(0);
    expect(result.reseeded.length).toBeGreaterThan(0);
    // killed entries have strictly worse fitness than survivors in their island
    const killedRR = result.killed.map((e) => e.fitness.resolve_rate);
    const survivedRR = entries
      .filter((e) => !result.killed.includes(e))
      .map((e) => e.fitness.resolve_rate);
    // at least one survivor better than worst killed
    expect(Math.max(...survivedRR)).toBeGreaterThan(Math.min(...killedRR));
  });

  it("reseed before period → no-op", () => {
    const archive = new IslandArchive({
      islandCount: 2,
      reseedPeriod: 5,
      prngSeed: 42,
    });
    archive.insert(makeArchiveEntry({ sha: "a" }));
    const result = archive.reseed(2); // period 5 not reached
    expect(result.killed).toEqual([]);
    expect(result.reseeded).toEqual([]);
  });

  it("reseed does not reduce global size (never-auto-delete: killed → retired, not deleted)", () => {
    const archive = new IslandArchive({
      islandCount: 2,
      reseedPeriod: 1,
      prngSeed: 42,
    });
    for (let i = 0; i < 6; i++) {
      archive.insert(
        makeArchiveEntry({
          sha: `s-${i}`,
          fitness: makeFitness({ resolve_rate: 0.1 * i, token: 100, cache_hit: 0.5 }),
        }),
      );
    }
    const before = archive.size();
    archive.reseed(1);
    expect(archive.size()).toBe(before);
  });

  // =========================================================================
  // MapElitesArchive — behavior bins
  // =========================================================================
  it("MAP-Elites: insert better into occupied bin → old evicted (returned) and moved to retired", () => {
    const archive = new MapElitesArchive({
      // Constant behavior dim → both entries land in the SAME bin so the
      // stronger one must evict the weaker one (deterministic collision).
      behaviorDims: [() => 0],
      binCount: 10,
    });
    const weak = makeArchiveEntry({
      sha: "weak",
      fitness: makeFitness({ resolve_rate: 0.3, token: 100, cache_hit: 0.5 }),
    });
    archive.insert(weak);
    const strong = makeArchiveEntry({
      sha: "strong",
      fitness: makeFitness({ resolve_rate: 0.8, token: 100, cache_hit: 0.5 }),
    });
    const evicted = archive.insert(strong);
    // old (weak) evicted if they share a bin
    expect(evicted).not.toBeNull();
    if (evicted) {
      expect((evicted as ArchiveEntry).status).toBe("retired"); // not deleted
    }
    const bins = archive.bins();
    // strong present in bins, weak retired but still findable
    expect(bins.some((e) => e.sha === "strong")).toBe(true);
  });

  it("MAP-Elites: insert weaker into occupied bin → evicted=null (no replacement)", () => {
    const archive = new MapElitesArchive({
      // Same constant bin so weak and strong compete for one slot.
      behaviorDims: [() => 0],
      binCount: 10,
    });
    const strong = makeArchiveEntry({
      sha: "strong2",
      fitness: makeFitness({ resolve_rate: 0.8, token: 100, cache_hit: 0.5 }),
    });
    archive.insert(strong);
    const weak = makeArchiveEntry({
      sha: "weak2",
      fitness: makeFitness({ resolve_rate: 0.2, token: 100, cache_hit: 0.5 }),
    });
    const evicted = archive.insert(weak);
    expect(evicted).toBeNull();
  });
});
