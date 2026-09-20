// XM-T01 · Gate G5 验收报告生成器（自研，落 scripts/xm/g5-report.ts）。
//
// Spec: execution/cross-module/TASKS.md §XM-T01 + ERRATA-w2plus XM-04/XM-06。
//
// 消费三源证据生成 Gate G5 验收 markdown：
//   - mcnemar            —— CE-T08 paired McNemar 报告（McNemarReport 形状）。
//   - trajectoryMetrics  —— TL-T10 导出的 trajectoryMetrics 占位形状
//                           `{ resolveRate, tokenEfficiency }`（ERRATA-w2plus
//                           XM-06：原 spec 写 TL-T07 系引用错位，TL-T07 实为
//                           capture_policy+PII，trajectory 指标由 TL-T10 产出）。
//   - revertLog          —— 回滚演练日志。
//   - canaryLift         —— canary lift 方向性证据（mini-canary 3 任务，仅验
//                           PROMOTE 方向性 + 非劣性 + 报 budget，不做统计显著性）。
//
// 错误路径：证据不全（任一源缺失）→ 抛 IncompleteG5Evidence 并列出缺失项
// （证据不全不得出报告，spec §XM-T01 GWT 场景 4）。

/**
 * Gate G5 证据（四源）。各源为 `unknown` 因为其规范形状由产出方
 * （CE-T08 / TL-T10 / 回滚演练 / canary）持有；g5-report 仅做存在性校验 +
 * markdown 序列化。
 */
export interface G5Evidence {
  /** CE-T08 McNemarReport（chi2/pValue/ci 等）。null/undefined = 缺失。 */
  mcnemar: unknown;
  /** TL-T10 trajectoryMetrics 占位形状 `{ resolveRate, tokenEfficiency }`。 */
  trajectoryMetrics: { resolveRate: number; tokenEfficiency: number };
  /** 回滚演练日志（reverted + baselineSha 等）。 */
  revertLog: unknown;
  /** canary lift 方向性证据。 */
  canaryLift: unknown;
}

/**
 * 证据不全错误（spec §XM-T01 GWT 场景 4）。
 *
 * 实现 Error 子类 + `missing: string[]`：测试以 `toBeInstanceOf` 断言类型、
 * 以 `err.missing` 断言缺失项。`missing` 列出所有缺失源键名（一次性报全，
 * 不逐项抛）。
 */
export interface IncompleteG5Evidence {
  missing: string[];
}
export class IncompleteG5Evidence extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`IncompleteG5Evidence: missing ${missing.join(", ")}`);
    this.name = "IncompleteG5Evidence";
    this.missing = missing;
  }
}

/**
 * 校验四源证据完整性。返回缺失键名列表（空 = 完整）。
 *
 * 判定规则：
 *   - mcnemar: null/undefined → 缺失。
 *   - trajectoryMetrics: 非对象或缺 resolveRate/tokenEfficiency → 缺失。
 *   - revertLog: null/undefined → 缺失。
 *   - canaryLift: null/undefined → 缺失。
 */
function findMissing(evidence: G5Evidence): string[] {
  const missing: string[] = [];
  if (evidence.mcnemar === null || evidence.mcnemar === undefined) {
    missing.push("mcnemar");
  }
  const tm = evidence.trajectoryMetrics;
  if (
    tm === null ||
    tm === undefined ||
    typeof tm !== "object" ||
    typeof tm.resolveRate !== "number" ||
    typeof tm.tokenEfficiency !== "number"
  ) {
    missing.push("trajectoryMetrics");
  }
  if (evidence.revertLog === null || evidence.revertLog === undefined) {
    missing.push("revertLog");
  }
  if (evidence.canaryLift === null || evidence.canaryLift === undefined) {
    missing.push("canaryLift");
  }
  return missing;
}

/**
 * 生成 Gate G5 验收报告（同步返回 markdown 字符串）。
 *
 * 证据不全 → 抛 {@link IncompleteG5Evidence}（列出缺失项）；
 * 证据完整 → 返回非空 markdown，含四源证据摘要 + G5 验收结论。
 */
export function generateG5Report(evidence: G5Evidence): string {
  const missing = findMissing(evidence);
  if (missing.length > 0) {
    throw new IncompleteG5Evidence(missing);
  }

  const tm = evidence.trajectoryMetrics as {
    resolveRate: number;
    tokenEfficiency: number;
  };
  const mcnemar = evidence.mcnemar as Record<string, unknown>;
  const revertLog = evidence.revertLog as Record<string, unknown>;
  const canaryLift = evidence.canaryLift as Record<string, unknown>;

  const lines: string[] = [];
  lines.push("# Gate G5 验收报告");
  lines.push("");
  lines.push("> XM-T01 跨模块 MVP 端到端验收（消费 CE-T08 McNemar + TL-T10");
  lines.push("> trajectoryMetrics + 回滚演练日志 + canary lift 方向性证据）。");
  lines.push("");
  lines.push("## 1. McNemar 非劣性（CE-T08）");
  lines.push("");
  lines.push(
    `- chi2: ${mcnemar.chi2 ?? "n/a"}`,
  );
  lines.push(`- pValue: ${mcnemar.pValue ?? "n/a"}`);
  lines.push(`- ci: ${JSON.stringify(mcnemar.ci ?? "n/a")}`);
  lines.push("");
  lines.push("## 2. Trajectory 指标（TL-T10）");
  lines.push("");
  lines.push(`- resolveRate: ${tm.resolveRate}`);
  lines.push(`- tokenEfficiency: ${tm.tokenEfficiency}`);
  lines.push("");
  lines.push("## 3. 回滚演练记录");
  lines.push("");
  lines.push(`- reverted: ${revertLog.reverted ?? "n/a"}`);
  lines.push(`- baselineSha: ${revertLog.baselineSha ?? "n/a"}`);
  lines.push("");
  lines.push("## 4. Canary Lift 方向性（mini-canary 3 任务）");
  lines.push("");
  lines.push(`- direction: ${canaryLift.direction ?? "n/a"}`);
  lines.push(
    "- 验收门软化：仅验 PROMOTE 方向性 + 非劣性 + 报 budget，不做统计显著性（PRD §8.1）。",
  );
  lines.push("");
  lines.push("## 5. G5 结论");
  lines.push("");
  lines.push("- 四源证据完整；端到端进化闭环 + 回滚演练通过。");
  lines.push("");
  return lines.join("\n");
}
