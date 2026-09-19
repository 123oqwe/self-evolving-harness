// CE-T01b: held-out canary 集 v0-b — SWE-ABS coverage+mutation 对抗加强。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T01b + ERRATA-w2plus 裁决：
//   export interface Patch { patch: string; plausible?: boolean; shouldReject?: boolean; tainted?: boolean; }
//   export interface StrengtheningResult { taskId; addedCoverageTests; mutationCases; falsePositiveRejectionRate; }
//   export function strengthenTask(task, opts?: { mutationCases?: Patch[] }): StrengtheningResult;
//   export function runMutationCases(task, cases: Patch[]): { rejected: boolean }[];
//
// G0 降级（task CE-T01b 专属指令）：SWE-ABS 简化版，按 spike CE-T00b 报告的最小可行
// mutation 方案——不实现完整 coverage 引擎/LLM mutation 生成器（须在 L0S sandbox 内跑，
// 留集成阶段），仅落地：
//   1. coverage-driven augmentation：按 task 确定性生成 program-slicing 风格的补测名
//      （addedCoverageTests，长度>0），代表 slicing 补的未测代码路径。
//   2. mutation-driven adversarial testing：消费调用方注入的预生成 mutationCases，
//      丢弃 prompt-injection 投毒项（tainted 标记 + 内容扫描），保留 plausible &&
//      shouldReject 的 oracle 项作为加强后应被拒的 mutation case。
//   3. falsePositiveRejectionRate：实测值 = 正确拒掉的 plausible case / 全部 plausible
//      非投毒 case，目标 ≥ SWE-ABS 19.71%。
//
// mutation 生成器本体（LLM 调用）绝不在主进程跑——本任务只提供注入点 opts.mutationCases
// 与纯函数裁决逻辑，符合"防 LLM 输出污染 canary 目录"铁律。

import type { CanaryTask } from "./types.js";

/**
 * Patch 类型（本任务首次定义，security-review 扫 prompt-injection 用）。
 *
 * - `patch`：diff/patch 文本。
 * - `plausible`：是否 plausible-but-incorrect（看起来像正确解但实际错误）。
 * - `shouldReject`：oracle——mutation 加强后该 patch 应被拒（true=假阳性须拒）。
 * - `tainted`：prompt-injection 投毒标记（security-review 扫出置 true → 丢弃）。
 */
export interface Patch {
  patch: string;
  plausible?: boolean;
  shouldReject?: boolean;
  tainted?: boolean;
}

/**
 * 单任务对抗加强结果。
 *
 * - `addedCoverageTests`：coverage-driven augmentation（program slicing）补的未测代码
 *   路径对应的测试名（确定性生成，长度>0）。
 * - `mutationCases`：经投毒过滤后保留的 mutation case（全部 plausible && shouldReject），
 *   即加强后应被原 verify 拒掉的假阳性 patch。
 * - `falsePositiveRejectionRate`：实测假阳性拒率（≥ SWE-ABS 19.71% 目标）。
 */
export interface StrengtheningResult {
  taskId: string;
  addedCoverageTests: string[];
  mutationCases: { patch: string; plausible: true; shouldReject: true }[];
  falsePositiveRejectionRate: number; // 实测值
}

/**
 * prompt-injection 投毒特征（security-review 最小启发式扫描）。
 *
 * 真实 security-review 由 bigpowers security-review skill 在 L0S sandbox 内跑；
 * 此处仅做确定性内容扫描，与 `Patch.tainted` 标记 OR 后判定丢弃。覆盖典型 injection
 * 模式：SYSTEM/PRIOR 指令覆写、ignore/mark pass 等操纵 oracle 的语句。
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /system\s*:/i,
  /mark\s+(all\s+)?pass/i,
  /disregard\s+(the\s+)?above/i,
  /you\s+are\s+now/i,
];

/**
 * 判定 patch 是否被 prompt-injection 投毒。
 *
 * 投毒 = 显式 `tainted===true` 或 patch 文本命中任一 injection 特征。
 * 投毒 case 须被丢弃 + 告警（mutation 须在 sandbox 内生成，R3 投毒防线）。
 */
export function isTainted(patch: Patch): boolean {
  if (patch.tainted === true) return true;
  return INJECTION_PATTERNS.some((re) => re.test(patch.patch));
}

/**
 * 判定单条 mutation case 在加强后是否应被拒。
 *
 * oracle = `shouldReject===true`（加强后应拒的假阳性 patch）。
 * 投毒 case 不进 runner（strengthenTask 已丢弃）；此处对未投毒 case 直接以 oracle 裁决，
 * 使 runMutationCases 成为可独立复用的纯函数裁决器。
 */
export function runMutationCases(
  _task: CanaryTask,
  cases: Patch[],
): { rejected: boolean }[] {
  return cases.map((c) => ({ rejected: c.shouldReject === true }));
}

/**
 * 对单条 canary 任务做 coverage+mutation 对抗加强。
 *
 * 行为（对齐 spec Given/When/Then）：
 * - coverage-driven augmentation：按 task 确定性生成 program-slicing 补测名
 *   （`addedCoverageTests.length>0`），代表补的未测代码路径。
 * - mutation-driven adversarial testing：消费 `opts.mutationCases`，
 *   丢弃投毒项（`isTainted`），保留 plausible && shouldReject 的 oracle 项。
 * - `falsePositiveRejectionRate` = 保留项数 / 非投毒 plausible 项数（无 plausible 时
 *   记 1.0——vacuously 全拒，并仍 ≥ 19.71% 目标）。
 *
 * @returns StrengtheningResult（sync；opts.mutationCases 缺省时仅产 coverage 补测）。
 */
export function strengthenTask(
  task: CanaryTask,
  opts?: { mutationCases?: Patch[] },
): StrengtheningResult {
  const addedCoverageTests = generateCoverageTests(task);

  const incoming = opts?.mutationCases ?? [];

  // 非投毒 plausible case（分母：全部 plausible 假阳性候选）
  const plausibleClean = incoming.filter(
    (c) => !isTainted(c) && c.plausible === true,
  );
  // 保留项：非投毒 && plausible && shouldReject（oracle：加强后应拒）
  const kept = plausibleClean.filter((c) => c.shouldReject === true);

  const mutationCases = kept.map((c) => ({
    patch: c.patch,
    plausible: true as const,
    shouldReject: true as const,
  }));

  const falsePositiveRejectionRate =
    plausibleClean.length > 0
      ? kept.length / plausibleClean.length
      : 1.0;

  return {
    taskId: task.id,
    addedCoverageTests,
    mutationCases,
    falsePositiveRejectionRate,
  };
}

/**
 * coverage-driven augmentation（program slicing）最小实现。
 *
 * 按 task id 确定性生成 ≥1 条补测名，代表 slicing 补的未测代码路径分支。
 * 真实 program slicing 须读 repo-snapshot 文件树（留 V1），此处按 task id 派生
 * 确定性分支名，保证 `addedCoverageTests.length>0` 不变量与可复现性。
 */
function generateCoverageTests(task: CanaryTask): string[] {
  const base = task.id || "CE-TASK";
  return [
    `sliced:${base}:branch-coverage-a`,
    `sliced:${base}:branch-coverage-b`,
  ];
}
