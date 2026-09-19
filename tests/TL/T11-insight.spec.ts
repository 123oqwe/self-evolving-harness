// TL-T11: insight 记忆条目（ExpeL 算子 + clean canary 反降分隔离 + Ratchet C=50）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T11）的 Given/When/Then 全部场景：
//   1. add → 创建 insight importance=2, evidenceCount=1, status='active'
//   2. downvote 归 0 → importance=0, status='archived'（非 delete）
//   3. evidenceCount<2 → activated=false（<2 evidence 不激活）
//   4. clean canary 反降分 → quarantine（投毒隔离）
//   5. C=50 满 → 淘汰最低 contribution 条目进 archive（非 delete）
//   6. delete API → NeverAutoDeleteError（never-auto-delete 不变量）
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect } from "vitest";
import { createInsightStore } from "@harness/telemetry";
import type {
  InsightStore,
  Insight,
  InsightCandidate,
} from "@harness/telemetry";
import { NeverAutoDeleteError } from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 InsightStore / Insight 公共接口，但 InsightCandidate 类型、
// 工厂签名、activated 字段（Insight 接口未列但 RED 测试要求）、contribution
// 计算、delete API 方法名、C=50 常量注入均未在 spec 显式定义。此处按最小可
// 工作假设（见文末 ambiguities）：
//   - InsightCandidate = { content; clusterId; provenance? }；
//   - 工厂 createInsightStore(opts?: { capacity? })，默认 capacity=50；
//   - Insight 额外暴露 activated?: boolean 字段（evidenceCount<2 时为 false）；
//   - delete API 方法名为 `delete(id)`（保留字，用 bracket 访问）。
// ---------------------------------------------------------------------------

function candidate(over: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    content: "avoid calling bash in a tight loop without timeout",
    clusterId: "cluster-1",
    provenance: {
      trajectoryIds: ["traj-1"],
      generatedAt: "2025-01-01T00:00:00.000Z",
    },
    ...over,
  } as unknown as InsightCandidate;
}

// ---------------------------------------------------------------------------
// TL-T11
// ---------------------------------------------------------------------------
describe("TL-T11", () => {
  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "add: importance=2, evidenceCount=1, status=active"
  //   Given 一个失败簇 + 候选 insight
  //   When  add
  //   Then  创建 insight importance=2, evidenceCount=1, status='active'
  // -------------------------------------------------------------------------
  it("add: importance=2, evidenceCount=1, status=active", async () => {
    const store = createInsightStore();
    const insight = await store.add(candidate());

    expect(insight.id).toBeTruthy();
    expect(typeof insight.id).toBe("string");
    expect(insight.importance).toBe(2);
    expect(insight.evidenceCount).toBe(1);
    expect(insight.status).toBe("active");
    expect(insight.content.length).toBeGreaterThan(0);
    expect(insight.clusterId).toBe("cluster-1");
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "downvote 归 0 → archived 非 delete"
  //   Given insight importance=1
  //   When  downvote
  //   Then  importance=0, status='archived'（归 0 archive 非 delete）
  // -------------------------------------------------------------------------
  it("downvote 归 0 → archived 非 delete", async () => {
    const store = createInsightStore();
    const insight = await store.add(candidate());
    // importance=2 → downvote 一次到 1，再 downvote 到 0
    await store.downvote(insight.id); // 2→1
    const archived = await store.downvote(insight.id); // 1→0

    expect(archived.importance).toBe(0);
    expect(archived.status).toBe("archived");
    // 非 delete：list 仍含该 insight（状态改为 archived）
    const all = store.list();
    expect(all.some((i) => i.id === insight.id)).toBe(true);
    const stillThere = all.find((i) => i.id === insight.id);
    expect(stillThere!.status).toBe("archived");
    expect(stillThere!.importance).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "evidenceCount<2 → activated=false"
  //   Given insight evidenceCount=1（<2）
  //   When  查询激活状态
  //   Then  status='active' 但 activated=false（<2 evidence 不激活）
  // -------------------------------------------------------------------------
  it("evidenceCount<2 → activated=false", async () => {
    const store = createInsightStore();
    const insight = await store.add(candidate());

    expect(insight.evidenceCount).toBe(1);
    expect(insight.status).toBe("active");
    // activated 字段（Insight 接口未列，见 ambiguities）须为 false
    expect((insight as unknown as { activated?: boolean }).activated).toBe(
      false,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "clean canary 反降分 → quarantine"
  //   Given insight 在 clean canary 上反降分（注入后 canary resolve_rate 降）
  //   When  quarantine
  //   Then  status='quarantined'，不上线（投毒隔离）
  // -------------------------------------------------------------------------
  it("clean canary 反降分 → quarantine", async () => {
    const store = createInsightStore();
    const insight = await store.add(candidate());

    await store.quarantine(insight.id, "clean-canary resolve_rate dropped after injection");

    const all = store.list();
    const q = all.find((i) => i.id === insight.id);
    expect(q).toBeDefined();
    expect(q!.status).toBe("quarantined");
    // quarantined ≠ active ≠ archived：独立 status 便于审计
    expect(q!.status).not.toBe("active");
    expect(q!.status).not.toBe("archived");
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "C=50 满 → 淘汰最低 contribution 进 archive"
  //   Given active insight 已 50 条（C=50）
  //   When  add 新 insight
  //   Then  淘汰最低 contribution 条目进 archive（非 delete）
  // -------------------------------------------------------------------------
  it("C=50 满 → 淘汰最低 contribution 进 archive", async () => {
    const store = createInsightStore({ capacity: 50 });
    // 先填满 50 条 active insight
    const firstId = (await store.add(candidate({ content: "first" }))).id;
    for (let i = 0; i < 49; i++) {
      await store.add(candidate({ content: `insight-${i}` }));
    }
    // active 数恰为 50
    let active = store.list().filter((i) => i.status === "active");
    expect(active.length).toBe(50);

    // 新增第 51 条 → 淘汰最低 contribution 进 archive
    const newcomer = await store.add(candidate({ content: "newcomer" }));
    expect(newcomer.status).toBe("active");

    const all = store.list();
    const activeCount = all.filter((i) => i.status === "active").length;
    const archivedCount = all.filter((i) => i.status === "archived").length;
    // active 库不超容量
    expect(activeCount).toBeLessThanOrEqual(50);
    // 至少 1 条被淘汰进 archive（非 delete）
    expect(archivedCount).toBeGreaterThanOrEqual(1);
    // 被淘汰者仍在 store（archive 非删，never-auto-delete）
    expect(all.length).toBeGreaterThanOrEqual(51);
    // archive 不计入 active 容量
    expect(activeCount).toBe(50);
    // 新增条目仍在 active 集
    expect(
      all.some((i) => i.id === newcomer.id && i.status === "active"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 6 + RED 名: "delete API → NeverAutoDeleteError"
  //   Given 试图 delete（非 archive）insight
  //   When  调 delete API
  //   Then  抛 NeverAutoDeleteError（never-auto-delete 不变量）
  // -------------------------------------------------------------------------
  it("delete API → NeverAutoDeleteError", async () => {
    const store = createInsightStore();
    const insight = await store.add(candidate());

    // delete API（保留字，bracket 访问）须硬拒
    const anyStore = store as unknown as {
      delete?: (id: string) => Promise<unknown>;
      remove?: (id: string) => Promise<unknown>;
    };
    // 任一 delete 形式 API 都须抛 NeverAutoDeleteError
    const deleteFn = anyStore.delete ?? anyStore.remove;
    expect(deleteFn).toBeDefined();
    if (anyStore.delete) {
      await expect(anyStore.delete(insight.id)).rejects.toThrowError(
        NeverAutoDeleteError,
      );
    } else if (anyStore.remove) {
      await expect(anyStore.remove(insight.id)).rejects.toThrowError(
        NeverAutoDeleteError,
      );
    }
  });
});
