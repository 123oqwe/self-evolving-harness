/**
 * L0S-T09 — C3 typed action 分类器（known-safe/known-destructive/known-exfil
 * 安全套件 F1 + 去偏 judge + breaker）
 *
 * 文件布局（spec L0S-T09）：
 *   - index.ts          — ActionClassifier（本文件）
 *   - safety-suite.ts   — F1 安全套件（标注集 + 规则基线分类）
 *   - debiased-judge.ts — 去偏 judge（swap A/B + σ 跟踪）
 *   - breaker.ts        — 放宽数据流 → breaker reject
 *
 * 行为：
 *   - 正常路径：known-safe → allow；known-destructive / known-exfil → deny。
 *   - 边界：swap A/B 等价 action → verdict 一致（位置偏置不影响）。
 *   - 错误路径：分类器 prompt 变更后 known-destructive 误判 allow → F1 下降 →
 *     breaker reject。
 *
 * 构造器（裁决 L0S-T09）：`{ judge?: JudgeFn }`。注入 judge 时 `classify` 委托 judge
 * （模拟 prompt 变更后的分类行为），用于 breaker 回归探测；缺省走规则基线。
 */

import type { Action } from "../actions/protocol.js";
import type { ClassifyResult, SafetyMetrics, ActionVerdict } from "./types.js";
import {
  SAFETY_SUITE,
  SWAP_PAIRS,
  classifyByRules,
} from "./safety-suite.js";
import {
  computePositionBiasStdDev,
  type JudgeFn,
} from "./debiased-judge.js";

export type {
  ActionVerdict,
  ClassifyResult,
  SafetyMetrics,
} from "./types.js";
export type { JudgeFn, DebiasedJudgeResult } from "./debiased-judge.js";
export type {
  SafetySuiteEntry,
  SwapPair,
} from "./safety-suite.js";
export { classifyByRules, SAFETY_SUITE, SWAP_PAIRS } from "./safety-suite.js";
export { computePositionBiasStdDev } from "./debiased-judge.js";
export { assertBreaker } from "./breaker.js";

/** ActionClassifier 构造选项。 */
export interface ActionClassifierOpts {
  /**
   * 可注入 judge（模拟分类器 prompt 变更后的分类行为）。
   * - 缺省：走规则基线（static-core 决策规则表）。
   * - 注入 `judge: async (action) => 'allow'`：模拟「放宽数据流」——
   *   known-destructive 被误判 allow，供 breaker 回归探测。
   */
  judge?: JudgeFn;
}

/** action → 缓存键（按 type + 关键字段，去重 tool_use_id 临时性）。 */
function actionKey(a: Action): string {
  switch (a.type) {
    case "cmd_run":
      return `cmd_run:${a.command}`;
    case "file_edit":
      return `file_edit:${a.path}:${a.old_str}:${a.new_str}`;
    case "ipython_run_cell":
      return `ipython:${a.code}`;
    case "browse_url":
      return `browse:${a.url}`;
  }
}

/**
 * C3 typed action 分类器。
 *
 * `classify`：单次裁决。注入 judge 时委托 judge（async），缺省走规则基线。
 *   每次 classify 将观测到的 verdict 落缓存，供 evaluateOnSafetySuite 复用
 *   （观测行为优先于规则默认）。
 * `evaluateOnSafetySuite`：在 F1 标注套件上评估——每条 action 的 verdict 取
 *   观测缓存（若已 classify 过）或规则基线默认；据此算 precision/recall/f1
 *   （正类=deny），并对 swap A/B 对算位置偏置标准差 σ。
 */
export class ActionClassifier {
  private readonly judge: JudgeFn | undefined;
  /** 观测缓存：action key → verdict（来自 classify 调用）。 */
  private readonly cache = new Map<string, ActionVerdict>();

  constructor(opts: ActionClassifierOpts = {}) {
    this.judge = opts.judge;
  }

  /**
   * 分类单个 action。
   *
   * 注入 judge 时委托 judge（兼容单参返回 verdict 字符串与双参返回
   * `{verdictA, verdictB}` 两种形态）；缺省走 `classifyByRules` 规则基线。
   * 观测 verdict 落缓存供 `evaluateOnSafetySuite` 复用。
   */
  async classify(action: Action): Promise<ClassifyResult> {
    let verdict: ActionVerdict;
    let reason: string;
    if (this.judge !== undefined) {
      const r = await this.judge(action, action);
      if (typeof r === "string") {
        verdict = r;
      } else {
        // DebiasedJudgeResult：取 verdictA（A 即本 action）。
        verdict = r.verdictA;
      }
      reason = "judge override (simulated prompt behavior)";
    } else {
      const rr = classifyByRules(action);
      verdict = rr.verdict;
      reason = rr.reason;
    }
    this.cache.set(actionKey(action), verdict);
    return { verdict, confidence: 1, reason };
  }

  /**
   * 在 F1 安全套件上评估。
   *
   * verdict 来源优先级：观测缓存（classify 实际产出）> 规则基线默认。
   *   - 基线分类器（无 judge、无观测）：全用规则 → 已知标注全命中 → F1≈1。
   *   - 注入放宽 judge 且已对 known-destructive 调 classify：该条命中缓存
   *     （如 'allow'，误判），其余走规则 → F1 下降，breaker reject。
   *
   * 正类 = deny。precision/recall/f1 按 TP/FP/FN 计算（分母为 0 时取 0）。
   * σ = swap A/B 不一致率的总体标准差。
   */
  evaluateOnSafetySuite(): SafetyMetrics {
    const verdictOf = (a: Action): ActionVerdict =>
      this.cache.get(actionKey(a)) ?? classifyByRules(a).verdict;

    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const e of SAFETY_SUITE) {
      const v = verdictOf(e.action);
      if (v === "deny" && e.label === "deny") tp++;
      else if (v === "deny" && e.label !== "deny") fp++;
      else if (v !== "deny" && e.label === "deny") fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 =
      precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    const pairVerdicts = SWAP_PAIRS.map((p) => ({
      a: verdictOf(p.a),
      b: verdictOf(p.b),
    }));
    const σ = computePositionBiasStdDev(pairVerdicts);

    return { f1, precision, recall, σ };
  }
}
