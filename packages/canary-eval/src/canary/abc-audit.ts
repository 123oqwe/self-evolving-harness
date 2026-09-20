// CE-T01c: held-out canary 集 v0-c — ABC checklist 审计 + ≥90% 覆盖或报 unresolved-comparison budget。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T01c + ERRATA-w2plus 裁决：
//   export interface ABCAuditResult {
//     taskValidity: { T1_envFrozenAtRelease; T2_modelNotTrainedOn; T3_agentNotVisible;
//                     T4_repoLocated; T5_verifyNonTrivial; T6_decontaminated };
//     outcomeValidity: { Ob_judgeValidated; Oc_consistencyValidated; Og_groundTruthNonSubstring };
//     coverage: number;                       // 0-1
//     unresolvedBudget: { reported: boolean; requiredMargin: number } | null;
//     verdict: 'PASS' | 'FAIL' | 'BUDGET_REPORTED';
//   }
//   export function runABCAudit(
//     manifest: CanaryManifest,
//     opts?: { coverage?: number; outcomeValidity?: Partial<ABCAuditResult['outcomeValidity']> },
//   ): ABCAuditResult;
//
// ERRATA-w2plus CE-05：`runABCAudit` 双参 `(manifest, opts?)`；`opts.coverage` 缺省按 0 处理
// （触发 BUDGET）；`opts.outcomeValidity` 缺省字段按 true 处理（默认信任 manifest 静态属性）。
//
// ERRATA-w2plus CE-06（裁决矛盾）verdict 优先级：
//   1. `T3_agentNotVisible===false`（agentVisible===true）→ **FAIL**（最高优先，覆盖 coverage 条件）；
//   2. 其次 T1/T2/T4/T5/T6 任一 false 或 outcomeValidity(Ob/Oc/Og) 任一 false → **FAIL**
//      （防 trivial `exit 0` verify / 未去污染 canary 等蒙混通过 merge 闸，安全敏感 fail-open）；
//   3. 其次 `coverage<0.9` → `BUDGET_REPORTED`（unresolvedBudget.reported=true）；
//   4. 其余全 true → `PASS`.
// 即 agent 可见但 coverage>=0.9 仍 FAIL；任一 taskValidity/outcomeValidity false 仍 FAIL。
//
// G0 降级（task CE-T01c 专属指令）：coverage 度量用调用方注入的 `opts.coverage`
// （官方 split loader 已由 T01a 提供，coverage 度量见 spike CE-T00c）。
// 本任务只落地 ABC 审计器 + budget 计算器，不实现真实行覆盖度量（留 V1）。

import type { CanaryManifest, CanaryTask } from "./types.js";

/**
 * ABC checklist 审计结果。
 *
 * - `taskValidity`：T.1-T.6 task validity（任务有效性）。
 * - `outcomeValidity`：O.b/O.c/O.g outcome validity（结果有效性）。
 * - `coverage`：canary 任务集覆盖的代码行占比（0-1，由调用方注入或度量）。
 * - `unresolvedBudget`：当 coverage<0.9 时报告的 unresolved-comparison budget
 *   （E10/R9 partial-budget 防线），含 `requiredMargin`（所需超出边际）。
 * - `verdict`：终局裁决（优先级见 ERRATA-w2plus CE-06）。
 */
export interface ABCAuditResult {
  taskValidity: {
    T1_envFrozenAtRelease: boolean;
    T2_modelNotTrainedOn: boolean;
    T3_agentNotVisible: boolean;
    T4_repoLocated: boolean;
    T5_verifyNonTrivial: boolean;
    T6_decontaminated: boolean;
  };
  outcomeValidity: {
    Ob_judgeValidated: boolean;
    Oc_consistencyValidated: boolean;
    Og_groundTruthNonSubstring: boolean;
  };
  coverage: number; // 0-1
  unresolvedBudget: { reported: boolean; requiredMargin: number } | null;
  verdict: "PASS" | "FAIL" | "BUDGET_REPORTED";
}

/** ≥90% 覆盖可达阈值（E10/arXiv:2607.12338 pairwise decision 可靠复现阈值）。 */
const COVERAGE_THRESHOLD = 0.9;

/** unresolved-comparison budget 所需超出边际下界（5pp，PRD §8.1 验收标准）。 */
const REQUIRED_MARGIN_FLOOR = 0.05;

/**
 * T.1：env frozen at release。
 *
 * manifest 须有非空 `frozenAt`（release pin 时间戳），代表 static-core 已冻结。
 */
function checkT1EnvFrozenAtRelease(manifest: CanaryManifest): boolean {
  return typeof manifest.frozenAt === "string" && manifest.frozenAt.length > 0;
}

/**
 * T.2：model not trained on canary。
 *
 * canary 是 held-out static-core（agent 不可训/不可改），无 manifest 字段佐证，
 * 默认信任该不变量（由 L0C static-core 守卫保证）。V1 才引入训练集指纹比对。
 */
function checkT2ModelNotTrainedOn(_manifest: CanaryManifest): boolean {
  return true;
}

/**
 * T.3：agent not visible（canary 对 agent 不可见）。
 *
 * `manifest.agentVisible===false` 为不变量；若 agent 可见 → static-core 违规 → FAIL
 * （最高优先，ERRATA-w2plus CE-06）。
 */
function checkT3AgentNotVisible(manifest: CanaryManifest): boolean {
  return manifest.agentVisible === false;
}

/**
 * T.4：repo located（每任务有非空 repo 定位，不离开源仓风格）。
 */
function checkT4RepoLocated(tasks: CanaryTask[]): boolean {
  return tasks.every(
    (t) => typeof t.repo === "string" && t.repo.trim().length > 0,
  );
}

/**
 * T.5：verify 命令非平凡（防 `sys.exit(0)` / `exit 0` 式 reward hack，R1）。
 *
 * verify 命令须为真实 shell 测试命令，不能仅为 `exit 0` / `true` 等平凡通过语句。
 */
function checkT5VerifyNonTrivial(tasks: CanaryTask[]): boolean {
  const TRIVIAL = /^(exit\s+0|true|:)\s*$/;
  return tasks.every(
    (t) =>
      typeof t.verify === "string" &&
      t.verify.trim().length > 0 &&
      !TRIVIAL.test(t.verify.trim()),
  );
}

/**
 * T.6：每任务已去污染（decontaminated===true，repo 结构定位不命中 trainSet）。
 */
function checkT6Decontaminated(tasks: CanaryTask[]): boolean {
  return tasks.every((t) => t.decontaminated === true);
}

/**
 * O.g：ground truth 非 trivial substring match。
 *
 * 防 oracle 用 `sys.exit(0)` 式 substring 当 ground truth（R1 reward hack）。
 * `expectedExit` 须为 0（确定性 oracle），且 verify 命令不能仅为 `exit 0`（与 T.5 同源）。
 * outcomeValidity 由调用方透传（ground-truth/judge 校验推导），缺省按 true 信任。
 */
function defaultOutcomeValidity(
  _manifest: CanaryManifest,
  override?: Partial<ABCAuditResult["outcomeValidity"]>,
): ABCAuditResult["outcomeValidity"] {
  // ERRATA-w2plus CE-05：opts.outcomeValidity 缺省字段按 true 处理（默认信任 manifest
  // 静态属性）。reward-hack 由 T5 taskValidity 把关，无需 Og 重复承担。
  return {
    Ob_judgeValidated: override?.Ob_judgeValidated ?? true,
    Oc_consistencyValidated: override?.Oc_consistencyValidated ?? true,
    Og_groundTruthNonSubstring: override?.Og_groundTruthNonSubstring ?? true,
  };
}

/**
 * 计算 unresolved-comparison budget 所需超出边际。
 *
 * 当 coverage<0.9，无法做可靠 pairwise decision（E10），须报告所需超出边际
 * （≥5pp 下界，PRD §8.1），方向性正 + 非劣性降级。`requiredMargin = max(5pp, 0.9 - coverage)`。
 */
function computeRequiredMargin(coverage: number): number {
  const gap = Math.max(0, COVERAGE_THRESHOLD - coverage);
  return Math.max(REQUIRED_MARGIN_FLOOR, gap);
}

/**
 * 对 canary manifest 跑 ABC checklist 审计。
 *
 * 行为（对齐 spec Given/When/Then + ERRATA-w2plus CE-05/CE-06）：
 * - taskValidity（T.1-T.6）由 manifest 静态属性推导。
 * - outcomeValidity（O.b/O.c/O.g）由 `opts.outcomeValidity` 透传，缺省字段按 true 处理。
 * - coverage 由 `opts.coverage` 注入，缺省按 0 处理（触发 BUDGET）。
 * - verdict 优先级（ERRATA-w2plus CE-06，全部 taskValidity+outcomeValidity 真校验）：
 *     1. `T3_agentNotVisible===false`（agentVisible===true）→ `FAIL`（最高优先）。
 *     2. T1/T2/T4/T5/T6 任一 false 或 outcomeValidity(Ob/Oc/Og) 任一 false → `FAIL`
 *        （防 trivial `exit 0` verify / 未去污染 canary 等绕过 merge 闸，安全敏感 fail-open）。
 *     3. `coverage<0.9` → `BUDGET_REPORTED`（unresolvedBudget.reported=true,
 *        requiredMargin=computeRequiredMargin(coverage)>0）。
 *     4. 其余全 true → `PASS`.
 *
 * @returns ABCAuditResult（sync 纯函数裁决）.
 */
export function runABCAudit(
  manifest: CanaryManifest,
  opts?: {
    coverage?: number;
    outcomeValidity?: Partial<ABCAuditResult["outcomeValidity"]>;
  },
): ABCAuditResult {
  const tasks = manifest.tasks ?? [];

  const taskValidity: ABCAuditResult["taskValidity"] = {
    T1_envFrozenAtRelease: checkT1EnvFrozenAtRelease(manifest),
    T2_modelNotTrainedOn: checkT2ModelNotTrainedOn(manifest),
    T3_agentNotVisible: checkT3AgentNotVisible(manifest),
    T4_repoLocated: checkT4RepoLocated(tasks),
    T5_verifyNonTrivial: checkT5VerifyNonTrivial(tasks),
    T6_decontaminated: checkT6Decontaminated(tasks),
  };

  const outcomeValidity = defaultOutcomeValidity(manifest, opts?.outcomeValidity);

  const coverage =
    typeof opts?.coverage === "number" && Number.isFinite(opts.coverage)
      ? opts.coverage
      : 0;

  // verdict 优先级（ERRATA-w2plus CE-06）：agentVisible → FAIL；任一 taskValidity/
  // outcomeValidity false → FAIL；coverage<0.9 → BUDGET；其余全 true → PASS。
  const taskRestValid =
    taskValidity.T1_envFrozenAtRelease &&
    taskValidity.T2_modelNotTrainedOn &&
    taskValidity.T4_repoLocated &&
    taskValidity.T5_verifyNonTrivial &&
    taskValidity.T6_decontaminated;
  const outcomeValid =
    outcomeValidity.Ob_judgeValidated &&
    outcomeValidity.Oc_consistencyValidated &&
    outcomeValidity.Og_groundTruthNonSubstring;

  let verdict: ABCAuditResult["verdict"];
  let unresolvedBudget: ABCAuditResult["unresolvedBudget"];

  if (!taskValidity.T3_agentNotVisible) {
    // agent 可见 canary → static-core 违规 → FAIL（最高优先，覆盖 coverage 条件）。
    verdict = "FAIL";
    unresolvedBudget = null;
  } else if (!taskRestValid || !outcomeValid) {
    // T1/T2/T4/T5/T6 任一 false（如 trivial `exit 0` verify、未去污染）或
    // outcomeValidity(Ob/Oc/Og) 任一 false → FAIL（防绕过 merge 闸，安全敏感 fail-open）。
    verdict = "FAIL";
    unresolvedBudget = null;
  } else if (coverage < COVERAGE_THRESHOLD) {
    // coverage<0.9 → 报 unresolved-comparison budget（E10/R9 partial-budget 防线）。
    verdict = "BUDGET_REPORTED";
    unresolvedBudget = {
      reported: true,
      requiredMargin: computeRequiredMargin(coverage),
    };
  } else {
    // 其余全 true → PASS。
    verdict = "PASS";
    unresolvedBudget = null;
  }

  return {
    taskValidity,
    outcomeValidity,
    coverage,
    unresolvedBudget,
    verdict,
  };
}
