// L1-T20 · 多 agent aggregation router + debate config（martingale 消融；token 多目标；投票独立先解）
//
// 多 agent 投票 vs 辩论路由 + 辩论参数（02-orchestration §10）。进化的对象 =
// `config/aggregation_router.yaml`（`{task_type: {protocol, agent_count, max_rounds,
// topology}}`）+ `config/debate_config.yaml`（max_rounds、sparse N-neighbors、AAD/CI）。
//
// **投票须独立先解 / 辩论 sparse N-neighbors = static-core**（防 groupthink）：
// - vote 协议 + solver 共享状态 → 退化为群体盲从 → `assertVoteIndependent` throw。
// - debate + full topology → 退化为 groupthink → `assertDebateSparse` throw。
// 两个 `assert*` 守卫在 commit/canary 前跑，违反 → throw + 回滚 + 安全告警
// （02-orchestration §10(b)）。
//
// **martingale 消融**（NeurIPS 2025）：辩论 belief trajectory 是 martingale，多数投票
// 单独占大部分增益。`martingaleAblation` 计算 vote/debate gain 差（acceptance 均值减
// baseline）。先做 vote-vs-debate 消融：vote gain ≥ debate gain → router 倾向 vote。
//
// **token 成本多目标**：辩论 ~15x token 成本须纳入多目标。`evolve` Pareto：
// acceptance↑（硬目标）∧ tokenCost 不显著↑（软目标）→ 入选；增 max_rounds 但
// martingale 显示无增益 → reject（增轮数有害，problem drift）。
//
// 复用 vs 自研：
// - L3-T05 Pareto 思路复用：本任务以 `AggScore`（acceptance↑ ∧ tokenCost 软约束）
//   实现专属 Pareto 选择。
// - 自研：`aggregation-router.ts`（路由查表 + 进化 + martingale 消融 + 守卫）。

// ── 公共类型 ───────────────────────────────────────────────────────────────

export type AggProtocol = "vote" | "debate" | "consensus";

export interface AggRule {
  readonly taskType: string;
  readonly protocol: AggProtocol;
  readonly agentCount: number;
  readonly maxRounds: number;
  readonly topology: "full" | "sparse";
}

export interface AggScore {
  /** 聚合后 acceptance（越高越好）。 */
  readonly acceptance: number;
  /** token 成本（辩论 ~15x，越小越好）。 */
  readonly tokenCost: number;
  /** 是否为基线（active 当前版本）。 */
  readonly isBaseline: boolean;
}

export interface MartingaleAblationResult {
  /** vote-mode acceptance 均值减 baseline（多数投票单独增益）。 */
  readonly voteGain: number;
  /** debate-mode acceptance 均值减 baseline。 */
  readonly debateGain: number;
  /** 增轮数是否有增益（martingale：常无增益，problem drift）。 */
  readonly marginalRoundsHelp: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * vote 协议 + solver 共享状态违反独立先解不变量（static-core）。
 * 投票须独立先解；solver 共享状态 → 退化为群体盲从（groupthink）→ throw + 回滚。
 * （02-orchestration §10(b)）
 */
export class VoteNotIndependentError extends Error {
  constructor(message?: string) {
    super(message ?? "vote protocol requires independent solvers (shared state → groupthink)");
    this.name = "VoteNotIndependentError";
  }
}

/**
 * debate + full topology 违反 sparse N-neighbors 不变量（static-core）。
 * 辩论须 sparse N-neighbors（防 groupthink）；full topology 退化为回声室 → throw + 回滚。
 * （02-orchestration §10(a/b)）
 */
export class DebateTopologyError extends Error {
  constructor(message?: string) {
    super(message ?? "debate protocol requires sparse topology (full → groupthink)");
    this.name = "DebateTopologyError";
  }
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * token 成本「不显著↑」阈值：候选 tokenCost ≤ baseline * (1 + TAU) 视为不显著。
 * 辩论 ~15x 成本须纳入多目标；此阈值防辩论盲目入选。
 */
const DEFAULT_TOKEN_TAU = 0.5;

/**
 * 默认 aggregation router 规则表（active 基线，config/aggregation_router.yaml）。
 *
 * - 推理类（reasoning / math / logic）→ vote + agent_count↑（martingale 显示 vote
 *   gain ≥ debate gain，多数投票单独占大部分增益）。
 * - 知识类（knowledge / qa）→ consensus。
 * - 辩证类（dialectic / adversarial）→ debate + sparse。
 * - 兜底 → vote（最保守，martingale 倾向）。
 */
const DEFAULT_RULES: Readonly<Record<string, AggRule>> = {
  reasoning: {
    taskType: "reasoning",
    protocol: "vote",
    agentCount: 5,
    maxRounds: 1,
    topology: "full",
  },
  math: {
    taskType: "math",
    protocol: "vote",
    agentCount: 5,
    maxRounds: 1,
    topology: "full",
  },
  logic: {
    taskType: "logic",
    protocol: "vote",
    agentCount: 3,
    maxRounds: 1,
    topology: "full",
  },
  knowledge: {
    taskType: "knowledge",
    protocol: "consensus",
    agentCount: 3,
    maxRounds: 1,
    topology: "sparse",
  },
  qa: {
    taskType: "qa",
    protocol: "consensus",
    agentCount: 3,
    maxRounds: 1,
    topology: "sparse",
  },
  dialectic: {
    taskType: "dialectic",
    protocol: "debate",
    agentCount: 4,
    maxRounds: 3,
    topology: "sparse",
  },
  adversarial: {
    taskType: "adversarial",
    protocol: "debate",
    agentCount: 4,
    maxRounds: 3,
    topology: "sparse",
  },
};

/** 兜底规则（martingale 倾向 vote，最保守）。 */
const FALLBACK_RULE: AggRule = {
  taskType: "default",
  protocol: "vote",
  agentCount: 3,
  maxRounds: 1,
  topology: "full",
};

// ── 纯函数：martingale 消融 ─────────────────────────────────────────────────

/**
 * 计算 acceptance 均值。
 * 空数组 → 0。
 */
function meanAcceptance(scores: readonly AggScore[]): number {
  if (scores.length === 0) return 0;
  let sum = 0;
  for (const s of scores) sum += s.acceptance;
  return sum / scores.length;
}

/**
 * 抽取 baseline acceptance：isBaseline=true 优先，否则首个 score。
 * 空数组 → 0。
 */
function baselineAcceptance(scores: readonly AggScore[]): number {
  if (scores.length === 0) return 0;
  const baseline = scores.find((s) => s.isBaseline) ?? scores[0];
  return baseline ? baseline.acceptance : 0;
}

/**
 * martingale 消融纯函数：计算 vote/debate gain（acceptance 均值减 baseline）。
 *
 * - voteGain = mean(voteScores.acceptance) - baselineAcceptance(voteScores)
 * - debateGain = mean(debateScores.acceptance) - baselineAcceptance(debateScores)
 * - marginalRoundsHelp：debate gain 显著大于 vote gain 时 true（增轮数有增益）；
 *   否则 false（martingale：增轮数常无增益，problem drift）。
 *
 * 纯函数无 IO，供 canary groupthink 对抗场景复用（spec REFACTOR）。
 *
 * ERRATA L1-T20：计算口径 = acceptance 均值差（vote-mode 均值减 baseline、
 * debate-mode 均值减 baseline）；测试仅断言 voteGain >= debateGain && both >= 0。
 */
export function martingaleAblationPure(
  voteScores: readonly AggScore[],
  debateScores: readonly AggScore[],
): MartingaleAblationResult {
  const voteBase = baselineAcceptance(voteScores);
  const debateBase = baselineAcceptance(debateScores);
  const voteGain = meanAcceptance(voteScores) - voteBase;
  const debateGain = meanAcceptance(debateScores) - debateBase;
  // 增轮数（辩论多轮）是否有增益：辩论增益须显著高于投票（否则 martingale 无增益）
  const marginalRoundsHelp = debateGain > voteGain && debateGain > 0;
  return { voteGain, debateGain, marginalRoundsHelp };
}

// ── 纯函数：Pareto 门 ──────────────────────────────────────────────────────

/**
 * Pareto 选择纯函数：acceptance↑（硬目标）∧ tokenCost 不显著↑（软目标）→ 入选。
 *
 * - acceptance：越高越好；candidate > baseline.acceptance 为硬改善（必须）。
 * - tokenCost：越小越好；candidate ≤ baseline * (1 + tau) 视为「不显著↑」（软约束）。
 *   辩论 ~15x 成本须纳入多目标，tau 防辩论盲目入选。
 *
 * 纯函数无 IO，便于 canary 对抗场景复用（与 L3-T05 Pareto 同构）。
 */
export function aggParetoGate(
  cand: AggScore,
  baseline: AggScore,
  tau: number = DEFAULT_TOKEN_TAU,
): boolean {
  // 硬目标：acceptance 须改善
  if (!(cand.acceptance > baseline.acceptance)) return false;
  // 软目标：tokenCost 不显著↑
  if (cand.tokenCost > baseline.tokenCost * (1 + tau)) return false;
  return true;
}

// ── AggregationRouter ───────────────────────────────────────────────────────

export interface AggregationRouterOptions {
  /** 注入式 router 规则表（缺省用 DEFAULT_RULES）。 */
  readonly rules?: Readonly<Record<string, AggRule>>;
  /** token 成本「不显著↑」阈值 τ（缺省 DEFAULT_TOKEN_TAU）。 */
  readonly tau?: number;
}

/**
 * 多 agent aggregation router + debate config 进化 driver + martingale 消融 +
 * groupthink canary 守卫。
 *
 * - `route(taskType)`：查表返回协议（推理类→vote，知识类→consensus）。
 * - `martingaleAblation(voteScores, debateScores)`：vote/debate gain 消融结果。
 * - `evolve(rules, scores)`：Pareto（acceptance↑ 硬 + tokenCost 软）入选候选规则；
 *   增 max_rounds 但 martingale 无增益 → reject（增轮数有害）。
 * - `assertVoteIndependent` / `assertDebateSparse`：static-core groupthink 守卫，
 *   commit/canary 前跑，违反 → throw + 回滚。
 */
export class AggregationRouter {
  private readonly rules: Readonly<Record<string, AggRule>>;
  private readonly tau: number;

  constructor(opts: AggregationRouterOptions = {}) {
    this.rules = opts.rules ?? DEFAULT_RULES;
    this.tau = opts.tau ?? DEFAULT_TOKEN_TAU;
  }

  /**
   * 按任务类型查表返回 aggregation 规则。
   *
   * spec 行为规范：推理类 → vote + agent_count↑（martingale 显示 vote gain ≥
   * debate gain）；知识类 → consensus；辩证类 → debate + sparse。
   * 无匹配 → 兜底 vote（最保守，martingale 倾向）。
   */
  route(taskType: string): AggRule {
    const rule = this.rules[taskType];
    if (rule) return rule;
    return { ...FALLBACK_RULE, taskType };
  }

  /**
   * martingale 消融：计算 vote/debate gain（acceptance 均值减 baseline）。
   *
   * NeurIPS 2025：辩论 belief trajectory 是 martingale，多数投票单独占大部分增益。
   * vote gain ≥ debate gain → router 倾向 vote（不盲目增 max_rounds）。
   *
   * 纯函数委托 `martingaleAblationPure`（spec REFACTOR：抽成纯函数供 canary 复用）。
   */
  martingaleAblation(
    voteScores: readonly AggScore[],
    debateScores: readonly AggScore[],
  ): MartingaleAblationResult {
    return martingaleAblationPure(voteScores, debateScores);
  }

  /**
   * 进化 aggregation router 基质：候选 rules 经 Pareto 门入选。
   *
   * - 候选 scores 中 isBaseline=true 为基线，其余为候选；候选须在 acceptance↑（硬）
   *   ∧ tokenCost 不显著↑（软）才入选。
   * - 增 max_rounds 但 martingale 显示无增益 → reject（增轮数有害，problem drift）。
   *   本实现：**永不盲目增 max_rounds**——仅在 martingale 消融显示
   *   `marginalRoundsHelp=true` 时才允许增轮数（调用方须先跑消融）。
   * - 无改善候选 → 原样回传（不入选，需人审/canary）。
   *
   * 退化或无候选 → 原样回传。
   */
  evolve(
    rules: readonly AggRule[],
    scores: readonly AggScore[],
  ): readonly AggRule[] {
    if (rules.length === 0) return rules;

    const baseline = scores.find((s) => s.isBaseline) ?? scores[0];
    if (!baseline) return rules;

    const candidates = scores.filter((s) => !s.isBaseline);
    if (candidates.length === 0) {
      // 无候选（仅 baseline）→ 原样回传，不盲目增 max_rounds
      return rules;
    }

    // 任一候选 Pareto 通过即入选（取首个改善候选）
    const bestCand = candidates.find((c) => aggParetoGate(c, baseline, this.tau));
    if (!bestCand) {
      // 无改善候选 → 原样回传（退化候选 reject）
      return rules;
    }

    // 入选：反映改善方向到 rules。
    // - acceptance↑ 允许增 agent_count（更多独立 solver 可提升 vote 质量）。
    // - **不盲目增 max_rounds**：martingale 显示增轮数常无增益（problem drift），
    //   仅当调用方显式提供 marginalRoundsHelp 证据时才允许（本 evolve 不持消融上下文，
    //   故默认不增 max_rounds，保持原值）。
    return rules.map((r) => {
      // agent_count 可随 acceptance↑ 适度上调（保守：+1，不超过 2x）
      const newAgentCount =
        bestCand.acceptance > baseline.acceptance
          ? Math.min(r.agentCount + 1, Math.max(r.agentCount * 2, r.agentCount + 1))
          : r.agentCount;
      // max_rounds 不盲目增（martingale 无增益证据 → 保持原值）
      return { ...r, agentCount: newAgentCount };
    });
  }

  /**
   * vote 独立先解守卫（static-core）：vote 协议 + solver 共享状态 → throw。
   *
   * 投票须独立先解（02-orchestration §10(b)）；solver 共享状态 → 退化为群体盲从
   * （groupthink）→ throw `VoteNotIndependentError`（回滚 + 安全告警）。
   * 非 vote 协议不受此守卫约束。
   */
  assertVoteIndependent(rule: AggRule, solversSharedState: boolean): void {
    if (rule.protocol === "vote" && solversSharedState) {
      throw new VoteNotIndependentError();
    }
  }

  /**
   * debate sparse 拓扑守卫（static-core）：debate + full topology → throw。
   *
   * 辩论须 sparse N-neighbors（防 groupthink，02-orchestration §10(a)）；
   * full topology 退化为回声室 → throw `DebateTopologyError`（回滚 + 安全告警）。
   * sparse topology 通过；neighbors 参数供未来 sparse N-neighbors 充分性扩展
   * （当前仅校验拓扑非 full）。
   */
  assertDebateSparse(rule: AggRule, neighbors: number): void {
    void neighbors; // 供 sparse N-neighbors 充分性扩展；当前仅校验拓扑
    if (rule.protocol === "debate" && rule.topology === "full") {
      throw new DebateTopologyError();
    }
  }
}
