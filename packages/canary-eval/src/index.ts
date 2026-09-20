// @harness/canary-eval — Canary 评估集与验证器 harness（CE 模块）。
//
// CE-T01a 落地：canary 集加载（frozen release）+ SWE-rebench 风格去污染
// （repo 结构定位 = 仓库名相等，ERRATA-w2plus CE-02）。

export {
  loadCanary,
  isDecontaminated,
} from "./canary/loader.js";

export {
  computeManifestSha256,
  verifyManifestSha256,
} from "./canary/manifest-hash.js";

export type {
  CanaryTask,
  CanaryManifest,
  Trajectory,
} from "./canary/types.js";

// CE-T01b 落地：SWE-ABS coverage+mutation 对抗加强（G0 降级最小可行 mutation 方案）。
export {
  strengthenTask,
  runMutationCases,
  isTainted,
} from "./canary/swe-abs.js";

export type {
  Patch,
  StrengtheningResult,
} from "./canary/swe-abs.js";

// CE-T01c 落地：ABC checklist 审计 + ≥90% 覆盖或报 unresolved-comparison budget。
export { runABCAudit } from "./canary/abc-audit.js";

export type { ABCAuditResult } from "./canary/abc-audit.js";

// CE-T02 落地：确定性验证器 harness — verify: 命令 exit-code 裁决 / 单次连续 run / 禁跨 run 合并。
// VerifierRun/SandboxHandle 由 @harness/canary-eval 导出（ERRATA-w2plus CE-07/CE-25 跨任务契约：
// CE-T05 calibrateAgainstL0 入参 l0Verdicts: VerifierRun[]、CE-T07 FreshEvidence.verifications
// 复用本导出）。
export { runVerify, assertNoCrossRunMerge, CrossRunMergeViolation } from "./verifier.js";

export type { VerifierRun, SandboxHandle } from "./verifier.js";

// CE-T03 落地：AgentLens Lucky-Pass 过滤集成 — 拒绝盲目重试/regression 循环过的 trajectory。
// ERRATA-w2plus CE-10：filterAndTag 保留全部 entry + 打标（不剔除 luckyPass）。
// ERRATA-w2plus CE-11：返回 import('@harness/l3-engine').Trajectory（L3 导出该类型）。
export { detectLuckyPass, filterAndTag } from "./lucky-pass.js";

export type { LuckyPassVerdict } from "./lucky-pass.js";

// 通用循环检测器（CE-T03 REFACTOR，供 TL-T06 runaway-loop detector 复用）。
export {
  detectRetryLoops,
  detectRegressionLoops,
  callFingerprint,
  serializeInput,
  DEFAULT_RETRY_THRESHOLD,
  DEFAULT_REGRESSION_THRESHOLD,
} from "./loop-detector.js";

export type {
  ToolCall,
  RetryLoopResult,
  RegressionLoopResult,
} from "./loop-detector.js";

// CE-T04 落地：fresh-context reviewer — 异模型族/异 session / 只读权威证据 /
// MAX_REVIEW_ITERATIONS=5。
// ERRATA-w2plus CE-12：runFreshReviewer 双参 `(input, opts?)`；family 提取= model id 前缀。
// ERRATA-w2plus CE-13：nlSummary 键名固定小写驼峰，大小写/别名不敏感；
//   `as unknown` 强转注入运行时值触发 NLSummaryForbiddenError 合法。
// SameModelFamilyError / MAX_REVIEW_ITERATIONS / extractModelFamily / selectCrossFamilyJudge
// 见下方 judge-pool 共享块（REFACTOR 抽出，T05 复用）。
export {
  runFreshReviewer,
  NLSummaryForbiddenError,
} from "./reviewer.js";

export type {
  ReviewerInput,
  ReviewerOutput,
  ReviewerOptions,
  JSONLTranscript,
} from "./reviewer.js";

// CE-T04/CE-T05 共享：judge model pool 选择（REFACTOR 抽 src/judge-pool.ts）。
// T05 复用 selectCrossFamilyJudge / extractModelFamily / SameModelFamilyError。
export {
  MAX_REVIEW_ITERATIONS,
  extractModelFamily,
  selectCrossFamilyJudge,
  SameModelFamilyError,
} from "./judge-pool.js";

// CE-T08 落地：paired McNemar + unresolved-comparison budget 报告器（5-step audit protocol）。
// ERRATA-w2plus CE-19：runPairedMcNemar 双参 `(m, opts?)`；opts.coverage 缺省按 0。
// ERRATA-w2plus CE-20：n≈30 用 Yates 连续性校正 χ²；n<25 退化精确二项检验；CI=95% Wilson 区间。
export { runPairedMcNemar, mcnemarChi2Yates, exactBinomialPValue, IncompletePairsError } from "./mcnemar.js";

export type { PairedMatrix, McNemarReport } from "./mcnemar.js";

// CE-T05 落地：LLM-judge 去偏 — position swap A/B + length-controlled + CoT
// + combined-budget + σ 跟踪 + judge model pool。
// ERRATA-w2plus CE-14：runDebiasedJudge 四参 (a,b,cfg,opts?)。
// ERRATA-w2plus CE-15：同族 judge 剔除 throw SameModelFamilyError（judge 与 agent 同族）。
// ERRATA-w2plus CE-16：claimedGap=|scoreA-scoreB|；consistent=sigma<=claimedGap；
//   calibrateAgainstL0 accuracy 公式仅类型约束 ∈[0,1]。
// ERRATA-w2plus CE-25/CE-27：calibrateAgainstL0 入参 l0Verdicts: VerifierRun[] 复用
//   CE-T02 导出契约（VerifierRun 见上方 verifier.js 导出块）。
// Variant 类型为本模块首个定义处（CE-T05 接口签名），CE-T12 等后续任务复用此形状
// （L3 types.ts 未定义 Variant，不重复定义）。
export { runDebiasedJudge, calibrateAgainstL0 } from "./judge-debias.js";

export type {
  Variant,
  DebiasConfig,
  JudgeResult,
} from "./judge-debias.js";

// CE-T09 落地：canary Context Saturation Gap Δ 度量器
// （MAG perf − brute-force full-context baseline）。
// 阈值 5pp（DISCRIMINATION_THRESHOLD）与 CE-T08 McNemar n≈30 噪声带对齐。
export { computeSaturationGap, DISCRIMINATION_THRESHOLD } from "./saturation-gap.js";

export type { SaturationGap } from "./saturation-gap.js";

// CE-T06 落地：canary 发布管线 v0 — shadow 5% + 退化信号自动 revert（rainbow 模式）。
// ERRATA-w2plus CE-T06：canaryRelease 五参 `(..., observations, opts?)`；
//   `opts.baselineResolveRate` 注入，`drop = baseline - current`。
//   runtime mutation of revert thresholds 由 L0C pre-commit/breaker 守卫，
//   CE 侧仅守 `isRevertMechanismStaticCore()===true` 不变量 + 不 mutate policy。
export { canaryRelease, isRevertMechanismStaticCore } from "./release.js";

export type {
  ReleasePolicy,
  ReleaseEvent,
  CanaryObservations,
  CanaryReleaseOptions,
} from "./release.js";

// CE-T06 REFACTOR：revert 命令构造（static-core 标记，agent 运行时只读）。
export { buildRevertCmd } from "./revert.js";
