// TL-T02: 多 agent per-subagent 归因（attribution.ts）
//
// 多 agent 烧 ~15x token，须按 gen_ai.agent.id 归属到子 agent。父-子 agent 去重：
// subagent 的 cost 作为独立条目计入 session，不重复算到 parent（spec §TL-T02
// 多 agent 归因）。
//
// 数据结构：AgentTree 维护 session 内 (agentId → CostBreakdown 累计) + 父子关系。
// 归因上下文（sessionId/model/priceVersion）由最近一次 recordTurn 建立 ——
// attributeToSubagent 复用该上下文为 subagent 核算 cost。

import type { CostBreakdown } from "./usage";

// ---------------------------------------------------------------------------
// AgentTree：session 内按 agentId 累计 cost + 父子关系记录
// ---------------------------------------------------------------------------

/** 空白 CostBreakdown（累计起点）。 */
export function zeroCost(priceVersion: string): CostBreakdown {
  return {
    input_cost: 0,
    output_cost: 0,
    cache_read_cost: 0,
    cache_creation_cost: 0,
    reasoning_cost: 0,
    total: 0,
    price_version: priceVersion,
  };
}

/** 把一个 CostBreakdown 累加进目标（in-place）。price_version 取目标原有值。 */
export function accumulateCost(target: CostBreakdown, add: CostBreakdown): void {
  target.input_cost += add.input_cost;
  target.output_cost += add.output_cost;
  target.cache_read_cost += add.cache_read_cost;
  target.cache_creation_cost += add.cache_creation_cost;
  target.reasoning_cost += add.reasoning_cost;
  target.total += add.total;
}

export class AgentTree {
  /** sessionId → (agentId → 累计 CostBreakdown) */
  private sessions = new Map<string, Map<string, CostBreakdown>>();
  /** parentAgentId → Set<childAgentId>（父子关系，供审计） */
  private children = new Map<string, Set<string>>();

  /** 记录父子派生关系（idempotent）。 */
  registerSubagent(parentAgentId: string, childAgentId: string): void {
    let set = this.children.get(parentAgentId);
    if (set === undefined) {
      set = new Set();
      this.children.set(parentAgentId, set);
    }
    set.add(childAgentId);
  }

  /** 累加一笔 cost 到 (sessionId, agentId)。
   *  subagent cost 进自己条目，不进 parent 条目 —— parent 条目仅含其自身
   *  recordTurn 产生的 cost（去重不变量）。 */
  addCost(sessionId: string, agentId: string, cost: CostBreakdown): void {
    let sessionMap = this.sessions.get(sessionId);
    if (sessionMap === undefined) {
      sessionMap = new Map();
      this.sessions.set(sessionId, sessionMap);
    }
    let existing = sessionMap.get(agentId);
    if (existing === undefined) {
      existing = zeroCost(cost.price_version);
      sessionMap.set(agentId, existing);
    }
    accumulateCost(existing, cost);
  }

  /** 返回某 session 的 byAgent 快照 + total（Σ byAgent.total，无重复无丢失）。 */
  getSessionBreakdown(sessionId: string): {
    byAgent: Record<string, CostBreakdown>;
    total: number;
  } {
    const sessionMap = this.sessions.get(sessionId);
    const byAgent: Record<string, CostBreakdown> = {};
    let total = 0;
    if (sessionMap !== undefined) {
      for (const [agentId, cb] of sessionMap) {
        // 浅拷贝防外部篡改内部累计
        byAgent[agentId] = { ...cb };
        total += cb.total;
      }
    }
    return { byAgent, total };
  }
}
