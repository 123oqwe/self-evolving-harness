// CE-T04: fresh-context reviewer — 异模型族/异 session / 只读权威证据 / MAX_REVIEW_ITERATIONS=5。
//
// 严格对齐 execution/canary-eval/TASKS.md §CE-T04 + ERRATA-w2plus 裁决（CE-12/CE-13）：
// - 异模型族/异 session：reviewer modelFamily ≠ agent modelFamily（CE-12 family 提取=
//   model id 前缀）；同族 → throw `SameModelFamilyError`（self-preference 错误路径）。
// - 只读权威证据不读 NL summary：`ReviewerInput.nlSummary` 类型为 `never`，运行时若
//   注入 `nlSummary` 键（大小写/别名不敏感，CE-13：仅认准小写驼峰 `nlSummary` 键名）
//   → throw `NLSummaryForbiddenError`（不变量铁律）。
// - `MAX_REVIEW_ITERATIONS=5` 硬上限：reviewer loop 最多 5 轮，超限截断并落
//   `iterations=5`，禁止无限重试（PRD §6.2 L1）。
// - `missing` 字段 feed 回 agent loop（数组，可空），供 agent 补齐 spec acceptance 缺口。
//
// 复用铁律：bigpowers `request-review` fresh-context 双盲 reviewer（异 session、只读
// 权威证据）+ SpecPow execution-verification-before-completion fresh-evidence 同源。
// 真实 LLM 接入留集成阶段；本任务 mock LLM 调用，但保留 opts.judgePool 注入口。

import {
  MAX_REVIEW_ITERATIONS,
  SameModelFamilyError,
  extractModelFamily,
  selectCrossFamilyJudge,
} from "./judge-pool.js";

/**
 * 不读 NL summary 不变量铁律被违反。
 *
 * `ReviewerInput.nlSummary` 类型为 `never`；运行时通过 `as unknown` 强转注入
 * `nlSummary` 键（CE-13：仅认准小写驼峰 `nlSummary` 键名，大小写/别名不敏感——
 * `NL_SUMMARY` 等不触发）即抛本错误。
 */
export class NLSummaryForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NLSummaryForbiddenError";
  }
}

/** re-export，供 T05 与 barrel 统一从 reviewer 入口取用（REFACTOR 共享 judge-pool）。 */
export { SameModelFamilyError } from "./judge-pool.js";

/**
 * JSONL transcript 行（只读权威证据）。
 *
 * TL-T01 JSONL transcript 原始行形状由 telemetry 侧定义；CE 仅消费为 `unknown[]`
 * 只读透传，reviewer 不解析 NL summary 字段（铁律）。
 */
export type JSONLTranscript = unknown[];

/**
 * fresh-context reviewer 输入。
 *
 * - `transcript`：只读权威证据（TL-T01 JSONL transcript 原始行）。
 * - `authoritativeEvidence`：权威证据清单（文件内容/命令输出/测试结果），reviewer
 *   据此判 spec acceptance 完备性、summarized 字段遗漏、groupthink 语义。
 * - `nlSummary`：类型 `never`——不读 NL summary 不变量。运行时注入即违规。
 */
export interface ReviewerInput {
  transcript: JSONLTranscript;
  authoritativeEvidence: {
    files: string[];
    commands: string[];
    testResults: string[];
  };
  nlSummary?: never;
}

/**
 * fresh-context reviewer 输出。
 *
 * - `score` ∈ [0,1]：spec acceptance 完备性评分。
 * - `complete`：spec acceptance 是否完备（无 missing）。
 * - `missing`：缺失字段清单，feed 回 agent loop 补齐。
 * - `iterations` ≤5：reviewer loop 迭代次数（硬上限 MAX_REVIEW_ITERATIONS=5）。
 * - `modelFamily`：所选 reviewer judge 的模型族（≠ agent model family）。
 */
export interface ReviewerOutput {
  score: number;
  complete: boolean;
  missing: string[];
  iterations: number;
  modelFamily: string;
}

/** opts 注入 agentModelFamily 与 judgePool（保证“异模型族”校验可计算、可注入测试）。 */
export interface ReviewerOptions {
  agentModelFamily?: string;
  judgePool?: string[];
}

/**
 * 运行 fresh-context reviewer。
 *
 * 双参签名 `(input, opts?)`（ERRATA-w2plus CE-12）：
 * - `opts.agentModelFamily`：agent 模型族（注入，保证异族校验可计算、可测试）。
 * - `opts.judgePool`：judge model pool（注入，mock LLM 调用）。
 *
 * 行为规范（spec §CE-T04 Given/When/Then）：
 * 1. 异模型族 + cap iterations ≤5：
 *    Given trajectory + 权威证据 + 异族 judge → modelFamily ≠ agentFamily +
 *    iterations ≤5 + missing feed 回。
 * 2. input 含 nlSummary → throw `NLSummaryForbiddenError`（只读权威证据不变量）。
 * 3. reviewer 与 agent 同模型族 → throw `SameModelFamilyError`（self-preference）。
 */
export function runFreshReviewer(
  input: ReviewerInput,
  opts?: ReviewerOptions,
): Promise<ReviewerOutput> {
  // 不变量校验须 **同步** throw（spec §CE-T04 Given/When/Then 用
  // `expect(() => runFreshReviewer(...)).toThrow(...)` 同步断言；async 函数体内
  // throw 会变成 rejected promise 而非同步抛出，故校验放在返回 promise 之前）。

  // 不变量 1：不读 NL summary。仅认准小写驼峰 `nlSummary` 键名（CE-13）。
  // 运行时通过 `as unknown` 强转注入即违规——大小写/别名不敏感，故只查该键。
  if (
    typeof input === "object" &&
    input !== null &&
    "nlSummary" in input &&
    // `nlSummary?: never` 类型层禁值，但运行时 `as unknown` 可注入非 undefined 值。
    (input as unknown as Record<string, unknown>).nlSummary !== undefined
  ) {
    throw new NLSummaryForbiddenError(
      "fresh-context reviewer must not consume NL summary: " +
        "`nlSummary` field is forbidden (only authoritative evidence is read)",
    );
  }

  const agentFamily = (opts?.agentModelFamily ?? "").toLowerCase();
  const pool = opts?.judgePool ?? [];

  // 不变量 2：异模型族。pool 内全部同族 → throw SameModelFamilyError（同步）。
  // selectCrossFamilyJudge 内部用 extractModelFamily（model id 前缀）逐个比对。
  const judgeId = selectCrossFamilyJudge(pool, agentFamily);
  const modelFamily = extractModelFamily(judgeId);

  // 防御：所选 judge 须确实与 agent 异族（selectCrossFamilyJudge 已保证，双重校验）。
  if (modelFamily === agentFamily) {
    throw new SameModelFamilyError(
      `selected reviewer model family "${modelFamily}" equals agent family ` +
        `"${agentFamily}" (self-preference forbidden)`,
    );
  }

  // 正常路径：返回 promise（保持 awaitable 契约）。真实 LLM 接入留集成阶段；
  // 本任务 mock LLM 调用，按权威证据完备性判分。
  return Promise.resolve(computeReviewerOutput(input, modelFamily));
}

/**
 * mock reviewer 裁决：按权威证据完备性判分。
 *
 * iterations 硬上限 MAX_REVIEW_ITERATIONS=5；mock 下单轮即可裁决，但显式 cap 以守铁律。
 * `missing` 字段 feed 回 agent loop（数组，可空），供 agent 补齐 spec acceptance 缺口。
 */
function computeReviewerOutput(
  input: ReviewerInput,
  modelFamily: string,
): ReviewerOutput {
  const evidence = input.authoritativeEvidence;
  const hasEvidence =
    evidence.files.length > 0 ||
    evidence.commands.length > 0 ||
    evidence.testResults.length > 0;

  // spec acceptance 完备性：有权威证据即视为完备（mock；真实接入由 LLM 判）。
  const complete = hasEvidence;
  const score = hasEvidence ? 1 : 0;
  const missing: string[] = hasEvidence
    ? []
    : ["authoritativeEvidence: empty (no files/commands/testResults to review)"];

  // 显式 cap：绝不超 MAX_REVIEW_ITERATIONS，即便 mock loop 想跑更多轮。
  const iterations = Math.min(1, MAX_REVIEW_ITERATIONS);

  return {
    score,
    complete,
    missing,
    iterations,
    modelFamily,
  };
}
