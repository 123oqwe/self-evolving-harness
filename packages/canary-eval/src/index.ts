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
