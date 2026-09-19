// TL-T02: per-turn token/cost 计量（usage 五子类型 + 版本化价目表 + 多 agent 归因）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T02）的 Given/When/Then 全部场景：
//   1. computeCost：price_table@v1 含 claude-sonnet-4.5 价目 → 五子类型按价目表正确核算
//      （input 1M→$3, output 100k→$1.5, cache_read 500k→$0.15, total=4.65, price_version='v1'）
//   2. 边界：usage 五子类型任一为 0 → 该子类型 cost=0，不抛错（边界值 0 合法）
//   3. computeCost cache_read 折扣价 0.3 正确（防 total_tokens 漏折扣）
//   4. price_table：model 不在当前版本 → PriceNotFoundError（禁止静默用默认价）
//   5. recordTurn：上游传 total_tokens 字段而非五子类型 → TotalTokensRejectedError
//   6. attribution：parent A 派 subagent B（agentId='sub-B'）→ getSessionCost 含 A 与 sub-B
//      两个独立条目，B 的 cost 不重复算到 A
//   7. price_version：cost 落 price_version 字段
//
// 价目表（spec §TL-T02 行为规范 1，$/M token）：
//   claude-sonnet-4.5: { input:3, output:15, cache_read:0.3, cache_creation:3.75, reasoning:15 }
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
// 关于构造与未定形状的假设见文末（structured_output ambiguities）。
//
import { describe, it, expect } from "vitest";
import { createUsageAccountant } from "@harness/telemetry";
import type {
  Usage,
  UsageAccountant,
  CostBreakdown,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 价目表常量（spec 行为规范 1）——$/M token
// ---------------------------------------------------------------------------
const MODEL = "claude-sonnet-4.5";
const PRICE_VERSION = "v1";
const PER_M = 1_000_000;

// $/M 各子类型单价（与 spec 一致；computeCost = tokens / 1M × unit_price）
const UNIT = {
  input: 3,
  output: 15,
  cache_read: 0.3,
  cache_creation: 3.75,
  reasoning: 15,
} as const;

// 浮点稳健断言：cost 用 toBeCloseTo 避免二进制浮点抖动（行为断言，非 bit-exact）
function expectCost(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 6);
}

// spec §TL-T02 行为规范 1 的基准 usage：
//   { input:1_000_000, output:100_000, cache_read:500_000, cache_creation:0, reasoning:0 }
function baselineUsage(): Usage {
  return {
    input: 1_000_000,
    output: 100_000,
    cache_read: 500_000,
    cache_creation: 0,
    reasoning: 0,
  };
}

// ---------------------------------------------------------------------------
// TL-T02
// ---------------------------------------------------------------------------
describe("TL-T02", () => {
  // -------------------------------------------------------------------------
  // 场景 1 + RED 名:
  //   "computeCost: 五子类型按价目表正确核算"
  //   Given  price_table@v1 含 claude-sonnet-4.5: {input:3,output:15,
  //         cache_read:0.3,cache_creation:3.75,reasoning:15}（$/M）
  //   When   computeCost({input:1_000_000, output:100_000, cache_read:500_000,
  //         cache_creation:0, reasoning:0}, 'claude-sonnet-4.5', 'v1')
  //   Then   input_cost=3, output_cost=1.5, cache_read_cost=0.15,
  //         cache_creation_cost=0, reasoning_cost=0, total=4.65,
  //         price_version='v1'
  // -------------------------------------------------------------------------
  it("computeCost: 五子类型按价目表正确核算", () => {
    const acct = createUsageAccountant();
    const cost = acct.computeCost(baselineUsage(), MODEL, PRICE_VERSION);

    expectCost(cost.input_cost, 3); // 1M/1M × $3
    expectCost(cost.output_cost, 1.5); // 100k/1M × $15
    expectCost(cost.cache_read_cost, 0.15); // 500k/1M × $0.3
    expectCost(cost.cache_creation_cost, 0); // 0 × $3.75
    expectCost(cost.reasoning_cost, 0); // 0 × $15
    expectCost(cost.total, 4.65); // 3 + 1.5 + 0.15
    expect(cost.price_version).toBe(PRICE_VERSION);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名:
  //   "computeCost: cache_read 折扣价 0.3 正确（防 total_tokens 漏折扣）"
  //   给定 usage 仅含 cache_read=1M（其余 0），cache_read 须用折扣价 0.3/M 核算
  //   而非 input 价 3/M；total≈0.3（非 3）。这防止「求和 total_tokens × input 价」
  //   漏 cache 折扣致账单错（research §1.2）。
  // -------------------------------------------------------------------------
  it("computeCost: cache_read 折扣价 0.3 正确（防 total_tokens 漏折扣）", () => {
    const acct = createUsageAccountant();
    const usage: Usage = {
      input: 0,
      output: 0,
      cache_read: PER_M, // 1M cache_read tokens
      cache_creation: 0,
      reasoning: 0,
    };
    const cost = acct.computeCost(usage, MODEL, PRICE_VERSION);

    // cache_read 必须用折扣价 0.3/M → cost=0.3
    expectCost(cost.cache_read_cost, 0.3);
    // input/output/cache_creation/reasoning 全为 0 → 各自 cost=0
    expectCost(cost.input_cost, 0);
    expectCost(cost.output_cost, 0);
    expectCost(cost.cache_creation_cost, 0);
    expectCost(cost.reasoning_cost, 0);
    // total = 0.3，而非 3（若用 total_tokens×input 价会得 3，账单错）
    expectCost(cost.total, 0.3);
    // 行为门：total 不得等于「total_tokens × input 价」=1M/1M×3=3
    expect(cost.total).not.toBeCloseTo(UNIT.input, 6);
  });

  // -------------------------------------------------------------------------
  // 场景 3（边界）+ RED 名（额外，覆盖 spec 边界 G/W/T）:
  //   "computeCost: 子类型为 0 时 cost=0 且不抛错（边界值 0 合法）"
  //   Given  usage 五子类型有任一为 0
  //   When   computeCost
  //   Then   该子类型 cost=0，不抛错（边界值 0 合法）
  // -------------------------------------------------------------------------
  it("computeCost: 子类型为 0 时 cost=0 且不抛错（边界值 0 合法）", () => {
    const acct = createUsageAccountant();
    // 轮流把每个子类型设非 0、其余设 0，确保 0 子类型 cost=0 且整体不抛错
    const cases: { key: keyof Usage; tokens: number; unit: number }[] = [
      { key: "input", tokens: PER_M, unit: UNIT.input },
      { key: "output", tokens: PER_M, unit: UNIT.output },
      { key: "cache_read", tokens: PER_M, unit: UNIT.cache_read },
      { key: "cache_creation", tokens: PER_M, unit: UNIT.cache_creation },
      { key: "reasoning", tokens: PER_M, unit: UNIT.reasoning },
    ];
    for (const c of cases) {
      const usage: Usage = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_creation: 0,
        reasoning: 0,
      };
      usage[c.key] = c.tokens;
      // 不得抛错（边界值 0 合法）
      const cost: CostBreakdown = acct.computeCost(usage, MODEL, PRICE_VERSION);
      // 命中子类型 cost = tokens/1M × unit
      expectCost(cost[`${c.key}_cost` as keyof CostBreakdown] as number, c.unit);
      // 其余子类型 cost=0
      for (const other of cases) {
        if (other.key === c.key) continue;
        expectCost(
          cost[`${other.key}_cost` as keyof CostBreakdown] as number,
          0,
        );
      }
      expectCost(cost.total, c.unit);
    }
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名:
  //   "price_table: model 不存在 → PriceNotFoundError"
  //   Given  model 不在 price_table 当前版本
  //   When   computeCost
  //   Then   抛 PriceNotFoundError（禁止静默用默认价）
  // -------------------------------------------------------------------------
  it("price_table: model 不存在 → PriceNotFoundError", () => {
    const acct = createUsageAccountant();
    const unknownModel = "definitely-not-in-price-table-v1";
    // 任一合法 usage 即可，重点在 model 查不到
    const usage: Usage = {
      input: 100,
      output: 100,
      cache_read: 0,
      cache_creation: 0,
      reasoning: 0,
    };
    expect(() => acct.computeCost(usage, unknownModel, PRICE_VERSION)).toThrow(
      // 错误类型名须为 PriceNotFoundError（或其 instanceof）
      /PriceNotFoundError/,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名:
  //   "recordTurn: 拒 total_tokens 字段 → TotalTokensRejectedError"
  //   Given  上游传 total_tokens 字段而非五子类型
  //   When   recordTurn
  //   Then   抛 TotalTokensRejectedError（强制五子类型）
  // -------------------------------------------------------------------------
  it("recordTurn: 拒 total_tokens 字段 → TotalTokensRejectedError", async () => {
    const acct = createUsageAccountant();
    const sessionId = "sess-reject-total";
    const agentId = "A";
    // 上游只传 total_tokens，缺五子类型 → 运行时 schema 校验须拒
    const totalOnly = { total_tokens: 1_234_567 } as unknown as Usage;
    await expect(
      acct.recordTurn(sessionId, agentId, MODEL, totalOnly),
    ).rejects.toThrow(/TotalTokensRejectedError/);

    // 同时校验：传了 total_tokens 即便也带五子类型，仍须被拒
    // （spec「强制五子类型」语义——total_tokens 字段本身被禁用）
    const mixed = {
      total_tokens: 1_234_567,
      input: 1_000_000,
      output: 100_000,
      cache_read: 500_000,
      cache_creation: 0,
      reasoning: 0,
    } as unknown as Usage;
    await expect(
      acct.recordTurn(sessionId, agentId, MODEL, mixed),
    ).rejects.toThrow(/TotalTokensRejectedError/);
  });

  // -------------------------------------------------------------------------
  // 场景 6 + RED 名:
  //   "attribution: subagent cost 不重复算到 parent"
  //   Given  parent agent A 派 subagent B（agentId='sub-B'），B 产生 usage U
  //   When   attributeToSubagent('A','sub-B',U)
  //   Then   getSessionCost 报告含 {A: ..., 'sub-B': U-cost}，
  //          B 的 cost 不重复算到 A
  // -------------------------------------------------------------------------
  it("attribution: subagent cost 不重复算到 parent", async () => {
    const acct = createUsageAccountant();
    const sessionId = "sess-attrib";
    const parentAgent = "A";
    const subAgent = "sub-B";

    const usageA: Usage = {
      input: 200_000,
      output: 20_000,
      cache_read: 0,
      cache_creation: 0,
      reasoning: 0,
    };
    const usageB: Usage = {
      input: 50_000,
      output: 5_000,
      cache_read: 0,
      cache_creation: 0,
      reasoning: 0,
    };

    // A 先 recordTurn（建立 session 上下文 + A 的 cost）
    await acct.recordTurn(sessionId, parentAgent, MODEL, usageA);

    // A 派生 B，B 的 usage 经 attributeToSubagent 归属到 sub-B
    acct.attributeToSubagent(parentAgent, subAgent, usageB);

    // 预期：A 的 cost 仅来自 usageA（不被 B 污染）
    const expectedA = acct.computeCost(usageA, MODEL, PRICE_VERSION);
    // 预期：sub-B 的 cost 来自 usageB（spec「sub-B: U-cost」）
    const expectedB = acct.computeCost(usageB, MODEL, PRICE_VERSION);

    const session = acct.getSessionCost(sessionId);

    // getSessionCost 返回按 agentId 分组的 breakdown（形状见 ambiguities）。
    // 此处假设 byAgent: Record<agentId, CostBreakdown> + total: number。
    const byAgent = (session as unknown as {
      byAgent: Record<string, CostBreakdown>;
    }).byAgent;

    // A 与 sub-B 两个独立条目都存在
    expect(byAgent).toBeDefined();
    expect(byAgent[parentAgent]).toBeDefined();
    expect(byAgent[subAgent]).toBeDefined();

    // A 的 cost 仅来自 usageA（B 不重复算到 A）
    expectCost(byAgent[parentAgent].total, expectedA.total);
    expectCost(byAgent[parentAgent].input_cost, expectedA.input_cost);
    expectCost(byAgent[parentAgent].output_cost, expectedA.output_cost);

    // sub-B 的 cost 来自 usageB（U-cost）
    expectCost(byAgent[subAgent].total, expectedB.total);
    expectCost(byAgent[subAgent].input_cost, expectedB.input_cost);

    // 不变量：session total = A + B（无重复、无丢失）
    const sessionTotal = (session as unknown as { total: number }).total;
    expectCost(sessionTotal, expectedA.total + expectedB.total);
    // 显式断言「不重复」：A 的 cost 不包含 B
    expectCost(
      byAgent[parentAgent].total,
      expectedA.total /* 仅 A，不含 B */,
    );
    expect(byAgent[parentAgent].total).toBeLessThan(sessionTotal);
  });

  // -------------------------------------------------------------------------
  // 场景 7 + RED 名:
  //   "price_version: cost 落 price_version 字段"
  //   Given  computeCost(usage, model, 'v1')
  //   Then   返回的 CostBreakdown.price_version === 'v1'
  //         （价目表 version 必须随 cost 一起落记录，跨版本账单可比）
  // -------------------------------------------------------------------------
  it("price_version: cost 落 price_version 字段", () => {
    const acct = createUsageAccountant();
    const cost = acct.computeCost(baselineUsage(), MODEL, PRICE_VERSION);
    // price_version 字段存在且等于传入的版本
    expect(cost).toHaveProperty("price_version");
    expect(typeof cost.price_version).toBe("string");
    expect(cost.price_version).toBe(PRICE_VERSION);

    // 不同版本请求须落对应 version 字段（若实现支持多版本并存查询）
    const otherVersion = "v2";
    // 若 v2 价目表未实现，computeCost 可能抛 PriceNotFoundError；
    // 这里只验证「不抛时 price_version 字段正确」，抛错则跳过该断言。
    try {
      const costV2 = acct.computeCost(baselineUsage(), MODEL, otherVersion);
      expect(costV2.price_version).toBe(otherVersion);
    } catch {
      // v2 未配置：允许抛 PriceNotFoundError，不影响本测试主断言
    }
  });
});
