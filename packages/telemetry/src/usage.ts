// TL-T02: per-turn token/cost 计量（usage 五子类型 + 版本化价目表 + 多 agent 归因）
//
// static-core：usage 五子类型 {input,output,cache_read,cache_creation,reasoning}
// 落盘；total_tokens 禁用（漏 cache 折扣致账单错，research §1.2）。
// cost = Σ(token_subtype × price[model][subtype])，价目表版本化。
//
// 多 agent 归因：parent 派 subagent，subagent cost 作独立条目计入 session，
// 不重复算到 parent（spec §TL-T02 多 agent 归因）。
//
// 接口签名（spec §TL-T02 ERRATA 后）：
//   createUsageAccountant(opts?: { priceTableDir?: string }): UsageAccountant
//   recordTurn(sessionId, agentId, model, usage): Promise<void>
//   computeCost(usage, model, priceVersion): CostBreakdown
//   attributeToSubagent(parentAgentId, subagentAgentId, usage): void
//   getSessionCost(sessionId): SessionCostBreakdown

import type { Usage } from "./transcript-schema";
import {
  loadPriceTableRegistry,
  type PriceTableRegistry,
} from "./price-table";
import { AgentTree } from "./attribution";

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** 上游传 total_tokens 字段而非五子类型 → 抛此错（强制五子类型）。
 *  error message 含类名，同时支持 instanceof 与正则匹配。 */
export class TotalTokensRejectedError extends Error {
  constructor(message = "TotalTokensRejectedError: total_tokens field is forbidden; use the five subtypes {input,output,cache_read,cache_creation,reasoning}") {
    super(message);
    this.name = "TotalTokensRejectedError";
  }
}

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约）
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_creation_cost: number;
  reasoning_cost: number;
  total: number;
  price_version: string;
}

export interface SessionCostBreakdown {
  /** 按 agentId 分组（含 parent 与各 subagent 独立条目；
   *  subagent cost 不重复算到 parent）。 */
  byAgent: Record<string, CostBreakdown>;
  /** session 总 cost = Σ byAgent.total。 */
  total: number;
}

export interface UsageAccountant {
  /** 若 usage 含 total_tokens 字段（无论是否并存五子类型）→ 抛
   *  TotalTokensRejectedError（static-core 禁 total_tokens）。 */
  recordTurn(
    sessionId: string,
    agentId: string,
    model: string,
    usage: Usage,
  ): Promise<void>;
  computeCost(usage: Usage, model: string, priceVersion: string): CostBreakdown;
  /** 归属到最近一次 recordTurn 建立的 (sessionId, model, priceVersion) 上下文；
   *  subagent cost 用该 model+priceVersion 核算。 */
  attributeToSubagent(
    parentAgentId: string,
    subagentAgentId: string,
    usage: Usage,
  ): void;
  getSessionCost(sessionId: string): SessionCostBreakdown;
}

// ---------------------------------------------------------------------------
// 内部：total_tokens 检测 + 子类型归一
// ---------------------------------------------------------------------------

const PER_M = 1_000_000;

function hasTotalTokensField(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    Object.prototype.hasOwnProperty.call(obj, "total_tokens")
  );
}

/** 把运行时 usage 对象归一为五子类型（缺失视为 0；负数视为 0）。
 *  调用前须先经 hasTotalTokensField 拒绝。 */
function normalizeUsage(obj: unknown): Usage {
  const o = (obj ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = o[k];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    input: num("input"),
    output: num("output"),
    cache_read: num("cache_read"),
    cache_creation: num("cache_creation"),
    reasoning: num("reasoning"),
  };
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateUsageAccountantOpts {
  priceTableDir?: string;
}

export function createUsageAccountant(
  opts: CreateUsageAccountantOpts = {},
): UsageAccountant {
  const registry: PriceTableRegistry = loadPriceTableRegistry(
    opts.priceTableDir,
  );
  const defaultVersion = registry.defaultVersion();

  // 归因上下文：最近一次 recordTurn 建立
  let currentContext: { sessionId: string; model: string; priceVersion: string } | null =
    null;

  const tree = new AgentTree();

  function computeCost(
    usage: Usage,
    model: string,
    priceVersion: string,
  ): CostBreakdown {
    const prices = registry.getPrice(priceVersion, model); // 抛 PriceNotFoundError
    const input_cost = (usage.input / PER_M) * prices.input;
    const output_cost = (usage.output / PER_M) * prices.output;
    const cache_read_cost = (usage.cache_read / PER_M) * prices.cache_read;
    const cache_creation_cost =
      (usage.cache_creation / PER_M) * prices.cache_creation;
    const reasoning_cost = (usage.reasoning / PER_M) * prices.reasoning;
    const total =
      input_cost +
      output_cost +
      cache_read_cost +
      cache_creation_cost +
      reasoning_cost;
    return {
      input_cost,
      output_cost,
      cache_read_cost,
      cache_creation_cost,
      reasoning_cost,
      total,
      price_version: priceVersion,
    };
  }

  return {
    async recordTurn(
      sessionId: string,
      agentId: string,
      model: string,
      usage: Usage,
    ): Promise<void> {
      // 强制五子类型：total_tokens 字段被禁（无论是否并存五子类型）
      if (hasTotalTokensField(usage)) {
        throw new TotalTokensRejectedError();
      }
      const u = normalizeUsage(usage);
      // 建立归因上下文（后续 attributeToSubagent 复用）
      currentContext = {
        sessionId,
        model,
        priceVersion: defaultVersion,
      };
      const cost = computeCost(u, model, defaultVersion);
      tree.addCost(sessionId, agentId, cost);
    },

    computeCost,

    attributeToSubagent(
      parentAgentId: string,
      subagentAgentId: string,
      usage: Usage,
    ): void {
      if (hasTotalTokensField(usage)) {
        throw new TotalTokensRejectedError();
      }
      if (currentContext === null) {
        throw new Error(
          "attributeToSubagent called with no active recordTurn context",
        );
      }
      const u = normalizeUsage(usage);
      const { sessionId, model, priceVersion } = currentContext;
      const cost = computeCost(u, model, priceVersion);
      tree.registerSubagent(parentAgentId, subagentAgentId);
      // subagent cost 进自己条目，不进 parent（去重不变量）
      tree.addCost(sessionId, subagentAgentId, cost);
    },

    getSessionCost(sessionId: string): SessionCostBreakdown {
      return tree.getSessionBreakdown(sessionId);
    },
  };
}
