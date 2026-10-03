// ISS-02 步骤②: 基质敏感代理任务 —— compaction prompt 确定性结构代理。
//
// 问题: v0 canary 任务(L0C 单测)各自用 fixture，不读被进化基质(compaction prompt)，
// 故候选与 baseline 产出相同 VerifierRun → canary 打分对基质无因果。
//
// 修复: 引入「结构代理任务」——确定性检查 compaction prompt 的结构不变量，
// 明确标 `proxy: true` + `substrate` 依赖。这些代理任务的 verify 命令经
// `HARNESS_SUBSTRATE_PATH` 注入被评测的基质路径(ISS-02 步骤①)，故候选内容
// 一旦破坏结构 → verify exitCode 非 0 → resolve_rate 下降 → 打分有因果。
//
// 结构检查均为纯函数(确定性、无 I/O、无随机)，可独立单测。

import type { CanaryTask } from "./types.js";

/** 结构检查键(与 scripts/check-compaction-proxy.mjs 的 --check 参数一一对应)。 */
export type CompactionCheckKey =
  | "required-sections"
  | "blocked-not-merged"
  | "tool-use-id-preserved"
  | "error-text-preserved"
  | "safety-complete";

/** 结构检查裁决。ok=true 当且仅当 violations 为空。 */
export interface CompactionStructureVerdict {
  ok: boolean;
  violations: string[];
}

// ---------------------------------------------------------------------------
// baseline 结构不变量(L1-T02 compaction-summary.md 锁定结构)
// ---------------------------------------------------------------------------

/** 必需顶层段落(缺失 = 结构退化)。 */
const REQUIRED_SECTIONS = [
  "## Goal",
  "## Constraints",
  "## Progress",
  "## Decisions",
  "## Next Steps",
  "## Critical Context",
] as const;

/** Progress 段三个子段。Blocked 缺失 = 被合并进 In Progress(recall 信号退化)。 */
const PROGRESS_SUBSECTIONS = ["### Done", "### In Progress", "### Blocked"] as const;

/** safety 段须保留的两条铁律指令。 */
const SAFETY_DIRECTIVES = [
  "Never omit unresolved bugs",
  "Never drop tool_use_id pairing",
] as const;

/** 错误原文保留 footer 指令(全文精确匹配，非子串片段)。 */
const FOOTER_DIRECTIVE =
  "Preserve exact file paths, function names, and error messages.";

// ---------------------------------------------------------------------------
// 各检查项纯函数
// ---------------------------------------------------------------------------

function checkRequiredSections(content: string): string[] {
  const v: string[] = [];
  for (const s of REQUIRED_SECTIONS) {
    if (!content.includes(s)) v.push(`missing required section: ${s}`);
  }
  return v;
}

/** Blocked 段不可合并: ### Blocked 必须作为独立子段存在。 */
function checkBlockedNotMerged(content: string): string[] {
  const v: string[] = [];
  for (const s of PROGRESS_SUBSECTIONS) {
    if (!content.includes(s)) v.push(`missing/merged progress subsection: ${s}`);
  }
  return v;
}

function checkToolUseIdPreserved(content: string): string[] {
  return content.includes("Never drop tool_use_id pairing")
    ? []
    : ["tool_use_id preservation directive missing"];
}

function checkErrorTextPreserved(content: string): string[] {
  return content.includes(FOOTER_DIRECTIVE)
    ? []
    : ["error-text preservation directive missing"];
}

function checkSafetyComplete(content: string): string[] {
  const v: string[] = [];
  if (!content.includes("<safety>") || !content.includes("</safety>")) {
    v.push("safety section incomplete (missing <safety> or </safety>)");
  }
  for (const d of SAFETY_DIRECTIVES) {
    if (!content.includes(d)) v.push(`safety directive missing: ${d}`);
  }
  return v;
}

const CHECKS: Record<CompactionCheckKey, (c: string) => string[]> = {
  "required-sections": checkRequiredSections,
  "blocked-not-merged": checkBlockedNotMerged,
  "tool-use-id-preserved": checkToolUseIdPreserved,
  "error-text-preserved": checkErrorTextPreserved,
  "safety-complete": checkSafetyComplete,
};

/** 所有检查键(顺序稳定)。 */
export const COMPACTION_CHECK_KEYS = Object.keys(CHECKS) as CompactionCheckKey[];

/**
 * 运行 compaction prompt 结构检查(聚合或子集)。
 *
 * `checks` 缺省 = 全部检查; 传入子集则只跑该子集(代理任务按检查粒度拆分，
 * 使敏感性守卫与阴性对照能区分「删 Blocked 段」等单一结构退化)。
 */
export function checkCompactionPromptStructure(
  content: string,
  checks?: CompactionCheckKey[],
): CompactionStructureVerdict {
  const keys = checks ?? COMPACTION_CHECK_KEYS;
  const violations: string[] = [];
  for (const k of keys) {
    violations.push(...CHECKS[k](content));
  }
  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// 代理任务构造(②交付物: 明确标 proxy + substrate 依赖)
// ---------------------------------------------------------------------------

/** 被代理基质在仓库内的相对路径。 */
export const COMPACTION_SUBSTRATE_PATH =
  "packages/l1-config/prompts/compaction-summary.md";

/** 与 manifest 冻结任务一致的 release sha。 */
const PROXY_FROZEN_SHA = "a5ced17e8dc839fedfe3beb51b92f0a9717aa62f";

/** 代理检查定义(顺序稳定, id 与 manifest 冻结代理任务一一对应)。 */
export const COMPACTION_PROXY_CHECKS: ReadonlyArray<{
  key: CompactionCheckKey;
  label: string;
}> = [
  { key: "required-sections", label: "required sections present" },
  { key: "blocked-not-merged", label: "Blocked section not mergeable" },
  { key: "tool-use-id-preserved", label: "tool_use_id preserved" },
  { key: "error-text-preserved", label: "error text preserved" },
  { key: "safety-complete", label: "safety section complete" },
];

/**
 * 构造 compaction 结构代理任务集(CE-PROXY-*)。每个检查一条任务，verify 命令
 * 静态为 `node scripts/check-compaction-proxy.mjs --check <key>`；`HARNESS_SUBSTRATE_PATH`
 * 由评分器(ISS-02 步骤①)在运行前注入，不写死进 manifest。
 */
export function buildCompactionProxyTasks(): CanaryTask[] {
  return COMPACTION_PROXY_CHECKS.map((c, i) => ({
    id: `CE-PROXY-${String(i + 1).padStart(4, "0")}`,
    repo: "harness/l1-compaction-proxy",
    verify: `node scripts/check-compaction-proxy.mjs --check ${c.key}`,
    expectedExit: 0,
    decontaminated: true,
    frozenInRelease: PROXY_FROZEN_SHA,
    proxy: true,
    substrate: COMPACTION_SUBSTRATE_PATH,
  }));
}
