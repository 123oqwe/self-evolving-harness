// L2-T04a: ExpeL insight 失败聚类 feed [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T04a）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
import { describe, it, expect } from "vitest";
import { toInsightSeeds } from "@harness/l2-memory";
import type { FailureCluster } from "@harness/l2-memory";

describe("L2-T04a", () => {
  it("filters clusters size<2", () => {
    const clusters: FailureCluster[] = [
      {
        id: "c1",
        trajectories: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }],
        centroidSummary: "s1",
        size: 5,
      },
      {
        id: "c2",
        trajectories: [{ id: "t6" }, { id: "t7" }, { id: "t8" }],
        centroidSummary: "s2",
        size: 3,
      },
      {
        id: "c3",
        trajectories: [{ id: "t9" }],
        centroidSummary: "s3",
        size: 1,
      },
    ];
    const seeds = toInsightSeeds(clusters);
    expect(seeds.length).toBe(2);
    expect(seeds.map((s) => s.clusterId).sort()).toEqual(["c1", "c2"]);
    // seed 结构对齐
    expect(seeds[0].trajectoryIds.length).toBeGreaterThanOrEqual(2);
    expect(typeof seeds[0].summary).toBe("string");
  });

  it("empty clusters returns empty", () => {
    expect(toInsightSeeds([])).toEqual([]);
  });

  it("redacts credentials in trajectories", () => {
    const clusters: FailureCluster[] = [
      {
        id: "c1",
        trajectories: [
          { id: "t1", text: "AWS_SECRET_ACCESS_KEY=abcd1234" },
          { id: "t2", text: "token: AKIAEXAMPLE" },
        ],
        centroidSummary: "s1",
        size: 2,
      },
    ];
    const seeds = toInsightSeeds(clusters);
    expect(seeds.length).toBe(1);
    const json = JSON.stringify(seeds);
    expect(json).not.toContain("abcd1234");
    expect(json).not.toContain("AKIAEXAMPLE");
  });
});
