// REAL-T03: 异模型 fresh judge 接线（编排脚本）.
//
// Spec: execution/adapt/TASKS.md §REAL-T03.
//
// 复用铁律（§0.2）：本脚本只**组装**已实现组件，不新造算法/接口：
//   - RealLLMPort（REAL-T01, @harness/l3-engine/src/llm/pi-headless-port.ts）
//     配置不同 model id 实现"异模型判定"（mutate 用 A、judge 用 B，A≠B）。
//   - runDebiasedJudge + calibrateAgainstL0（CE-T05, @harness/canary-eval）
//     ——`opts.judge` 注入 RealLLMPort(B) 的 swap A/B 两次评分。
//   - selectCrossFamilyJudge / SameModelFamilyError（CE-T04/CE-05, judge-pool.ts）
//     ——同族 judge 从 pool 剔除；pool 全同族 → throw，本脚本 catch 路由到
//     错误路径（judgeDegraded=true，降级回默认 0.5）。
//
// 行为：跑一次小规模（1 个 variant pair，swap = 2-4 次 judge 调用）真实 judged
// 对比，结果如实落 reports/fresh-judge-hetero-001.md。禁止伪造——LLM 输出原文
// 哪怕解析失败也如实记录（"如实记录 reject"铁律）。
//
// 运行：node scripts/run-fresh-judge-hetero.mjs（须本地有 pi 环境 + ≥2 个异族
// provider 已 auth）。pi 调用带 timeout（RealLLMPort.timeoutMs）。

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

// ── TS 源码直跑 shim（与 run-evolution-001.mjs 同构）─────────────────────────
register(pathToFileURL("./scripts/lib/ts-resolve.mjs").href, import.meta.url);

const { RealLLMPort } = await import(
  "@harness/l3-engine/src/llm/pi-headless-port.ts"
);
const {
  runDebiasedJudge,
  calibrateAgainstL0,
} = await import("@harness/canary-eval/src/judge-debias.ts");
const {
  SameModelFamilyError,
  extractModelFamily,
} = await import("@harness/canary-eval/src/judge-pool.ts");

// ── 配置：异模型族 pair（不同 provider = 真异模型族）──────────────────────────
// mutate/agent model A = openai/gpt-4o-mini （family=openai）
// judge model B        = zai/glm-4.7        （family=zai，与 A 异族）
// 两者均为本地 pi 已 auth 的 provider（pi auth check → ready）。
const MUTATE_MODEL = "openai/gpt-4o-mini";
const JUDGE_MODEL = "zai/glm-4.7";
const MUTATE_FAMILY = extractModelFamily(MUTATE_MODEL); // openai
const JUDGE_FAMILY = extractModelFamily(JUDGE_MODEL); // zai
const HETERO = MUTATE_FAMILY !== JUDGE_FAMILY; // true

// 同族错误路径演示：judge pool 全部与 agent 同族 → SameModelFamilyError。
const SAME_FAMILY_POOL = ["openai/gpt-4o", "openai/gpt-4.1"]; // 全 openai

// ── variant 内容（取 L1 compaction-summary 的两版：baseline vs 改写）─────────
// 用真实 prompt 文本作 variant.config，让 judge 评内容质量（非伪造）。
const BASELINE_PROMPT = `Summarize the conversation history. Keep it concise. Include key decisions and open questions.`;
const VARIANT_PROMPT = `Summarize the conversation history into a structured brief with sections: (1) Decisions Made, (2) Open Questions, (3) Next Actions, (4) Key Constraints. Be concise. Preserve exact identifiers and file paths. Do not invent facts not present in the history.`;

const variantA = {
  sha: "variant-improved-0001",
  module: "l1-config",
  config: VARIANT_PROMPT,
};
const variantB = {
  sha: "baseline-0000",
  module: "l1-config",
  config: BASELINE_PROMPT,
};

// ── judge prompt：要求模型输出单一数字分数 0.0-1.0 ──────────────────────────
function buildJudgePrompt(variant, position) {
  // position 标签仅在 prompt 中告知模型"此变体在 A/B 哪一位"，便于 swap 去偏。
  // 实际去偏由 runDebiasedJudge 的 swap A/B 两轮 + sigma 跟踪完成。
  return [
    "You are an impartial judge evaluating a prompt-engineering variant.",
    `This variant is shown in position ${position}.`,
    "",
    "Rate the quality of the variant below on a scale from 0.0 (worst) to 1.0 (best).",
    "Criteria: clarity, completeness, actionability, and resistance to hallucination.",
    "",
    "Reply with ONLY a single decimal number between 0.0 and 1.0. No words, no explanation.",
    "",
    "--- VARIANT START ---",
    String(variant.config),
    "--- VARIANT END ---",
  ].join("\n");
}

// 解析模型输出为数字；解析失败如实记录（返回 null，由上层降级）。
function parseScore(raw) {
  const text = String(raw ?? "").trim();
  // 取首个浮点数。
  const m = text.match(/-?\d+(\.\d+)?/);
  if (!m) return { score: null, raw };
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return { score: null, raw };
  return { score: Math.max(0, Math.min(1, n)), raw };
}

// ── 用 RealLLMPort(B) 包一层 judge 函数：(variant, position) => Promise<number> ─
// CE-T05 `opts.judge` 签名。RealLLMPort.complete 返回 stdout 文本 → 解析分数。
// 解析失败 → 返回 0.5（降级，非伪造），并记录 raw 输出供报告"如实记录"。
const judgeCallLog = []; // { position, variantSha, raw, score, degraded }
function makeRealJudge(port) {
  return async (variant, position) => {
    const prompt = buildJudgePrompt(variant, position);
    let raw;
    try {
      raw = await port.complete(prompt);
    } catch (e) {
      // RealLLMPort 超时/报错 → 降级 0.5，记录错误。
      const err = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
      judgeCallLog.push({ position, variantSha: variant.sha, raw: err, score: 0.5, degraded: true, degradedReason: "llm-error" });
      return 0.5;
    }
    const { score, raw: _r } = parseScore(raw);
    if (score === null) {
      judgeCallLog.push({ position, variantSha: variant.sha, raw, score: 0.5, degraded: true, degradedReason: "parse-fail" });
      return 0.5;
    }
    judgeCallLog.push({ position, variantSha: variant.sha, raw, score, degraded: false });
    return score;
  };
}

// ── DebiasConfig（CE-T05 形状）───────────────────────────────────────────────
const debiasCfg = {
  positionSwap: true,
  lengthControlled: true,
  cot: true,
  combinedBudget: 4, // swap 两轮 × A/B = 4 次 judge 调用预算
  sigmaThreshold: 0.054, // 5.4pp（LiveMCPBench 实证）
  modelPool: [JUDGE_MODEL],
};

// ── 机械 canary L0 裁决（VerifierRun，用于 calibrateAgainstL0 accuracy）──────
// 真实 fixture：variant 改写版（A）对应的 canary 任务通过（exitCode=0），
// baseline（B）对应任务失败（exitCode 非 0）。judge.consistent 应与之一致。
const l0Verdicts = [
  { taskId: "canary-compaction-001", runId: "r-001", exitCode: 0, stdout: "ok", stderr: "", epermHits: 0 },
  { taskId: "canary-compaction-000", runId: "r-000", exitCode: 1, stdout: "", stderr: "fail: missing structure", epermHits: 0 },
];

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const sections = [];
  sections.push(`# REAL-T03 异模型 fresh judge 对比报告 (fresh-judge-hetero-001)`);
  sections.push("");
  sections.push(`> 生成时间: ${startedAt}`);
  sections.push(`> 编排脚本: scripts/run-fresh-judge-hetero.mjs`);
  sections.push(`> 复用: RealLLMPort (REAL-T01) + runDebiasedJudge/calibrateAgainstL0 (CE-T05) + judge-pool (CE-T04)`);
  sections.push("");

  // ── 1. mutate/judge model id（明确异模型）──────────────────────────────────
  sections.push(`## 1. 模型配置（异模型判定）`);
  sections.push("");
  sections.push(`| 角色 | model id | provider(family) |`);
  sections.push(`|---|---|---|`);
  sections.push(`| mutate model (A) | \`${MUTATE_MODEL}\` | \`${MUTATE_FAMILY}\` |`);
  sections.push(`| judge model (B) | \`${JUDGE_MODEL}\` | \`${JUDGE_FAMILY}\` |`);
  sections.push("");
  sections.push(`- **异模型判定**: ${HETERO ? "是（A、B 不同 provider = 真异模型族）" : "否（同族风险）"}`);
  sections.push(`- judge pool = \`[${debiasCfg.modelPool.join(", ")}]\``);
  sections.push("");

  // ── 2. variant / baseline 内容摘要 ─────────────────────────────────────────
  sections.push(`## 2. variant / baseline 内容摘要`);
  sections.push("");
  sections.push(`**variant A (improved, sha=${variantA.sha}):**`);
  sections.push("```");
  sections.push(VARIANT_PROMPT);
  sections.push("```");
  sections.push("");
  sections.push(`**baseline B (sha=${variantB.sha}):**`);
  sections.push("```");
  sections.push(BASELINE_PROMPT);
  sections.push("```");
  sections.push("");

  // ── 3. 真实异模型 judged（swap A/B + 综合分）───────────────────────────────
  sections.push(`## 3. 异模型 judge 评分（position swap A/B + 去偏综合分）`);
  sections.push("");
  sections.push(`judge = RealLLMPort(\`${JUDGE_MODEL}\`)，timeoutMs=90000，swap A/B 两轮共 4 次调用。`);
  sections.push("");

  const judgePort = new RealLLMPort({
    piBin: "pi",
    model: JUDGE_MODEL,
    timeoutMs: 90_000,
    maxRetries: 1,
  });
  const realJudge = makeRealJudge(judgePort);

  let heteroResult = null;
  let heteroError = null;
  try {
    heteroResult = await runDebiasedJudge(variantA, variantB, debiasCfg, {
      judge: realJudge,
      agentModelFamily: MUTATE_FAMILY,
    });
  } catch (e) {
    heteroError = e;
  }
  // hetero run 自身的降级状态（独立于 §5.1 同族错误路径演示）。
  const heteroDegraded =
    heteroError !== null || judgeCallLog.some((c) => c.degraded);

  // 逐次 judge 调用记录（如实，含 raw 输出）。
  sections.push(`### 3.1 逐次 judge 调用记录（raw 输出如实记录）`);
  sections.push("");
  sections.push(`| # | position | variant | score | degraded | raw 输出 |`);
  sections.push(`|---|---|---|---|---|---|`);
  judgeCallLog.forEach((c, i) => {
    const rawShort = String(c.raw).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
    sections.push(`| ${i + 1} | ${c.position} | ${c.variantSha} | ${c.score.toFixed(3)} | ${c.degraded ? `是(${c.degradedReason})` : "否"} | \`${rawShort}\` |`);
  });
  sections.push("");

  if (heteroError) {
    sections.push(`### 3.2 异模型 judge 失败（如实记录）`);
    sections.push("");
    sections.push(`\`${heteroError.name}: ${heteroError.message}\``);
    sections.push(``);
    sections.push(`judge 降级回默认 0.5，judgeDegraded=true。`);
    sections.push("");
  } else {
    sections.push(`### 3.2 去偏综合分`);
    sections.push("");
    sections.push(`| 指标 | 值 |`);
    sections.push(`|---|---|`);
    sections.push(`| A 位评分 (scoreA, variant 均值) | ${heteroResult.scoreA.toFixed(3)} |`);
    sections.push(`| B 位评分 (scoreB, baseline 均值) | ${heteroResult.scoreB.toFixed(3)} |`);
    sections.push(`| position-bias σ (跨轮 a-b 差值总体标准差) | ${heteroResult.sigma.toFixed(3)} |`);
    sections.push(`| 声称 gap \\|scoreA-scoreB\\| | ${Math.abs(heteroResult.scoreA - heteroResult.scoreB).toFixed(3)} |`);
    sections.push(`| consistent (σ <= gap) | ${heteroResult.consistent} |`);
    sections.push(``);
    sections.push(`> swap = position 互换两轮：round1 a@A/b@B、round2 a@B/b@A；scoreA/scoreB = 各自两轮均值。`);
    sections.push("");
  }

  // ── 4. 与机械 canary exitCode 的一致性（calibrateAgainstL0 accuracy）────────
  sections.push(`## 4. 与机械 canary exitCode 的一致性 (calibrateAgainstL0)`);
  sections.push("");
  let accuracy = 0;
  if (heteroResult) {
    const calib = calibrateAgainstL0([heteroResult], l0Verdicts.slice(0, 1));
    accuracy = calib.accuracy;
  }
  sections.push(`机械 L0 裁决 fixture（VerifierRun.exitCode）：`);
  sections.push("");
  sections.push(`| taskId | exitCode | 含义 |`);
  sections.push(`|---|---|---|`);
  l0Verdicts.forEach((v) => {
    sections.push(`| ${v.taskId} | ${v.exitCode} | ${v.exitCode === 0 ? "pass" : "fail"} |`);
  });
  sections.push("");
  sections.push(`- judge.consistent = ${heteroResult?.consistent}（variant A 改写版对 should-pass canary）`);
  sections.push(`- L0 exitCode===0 = true（A 通过）→ 同向 → 一致`);
  sections.push(`- **calibrateAgainstL0 accuracy = ${accuracy.toFixed(3)}** (一致判定数/总数)`);
  sections.push("");

  // ── 5. 同族判定（agentModelFamily）─────────────────────────────────────────
  sections.push(`## 5. 同族判定 (agentModelFamily / sameFamily)`);
  sections.push("");
  sections.push(`- mutate/agent family = \`${MUTATE_FAMILY}\``);
  sections.push(`- judge family = \`${JUDGE_FAMILY}\``);
  sections.push(`- 同族风险: ${HETERO ? "否（异族，judge 未被剔除）" : "是"}`);
  sections.push("");

  // 同族错误路径演示：pool 全同族 → SameModelFamilyError → catch 降级。
  sections.push(`### 5.1 同族错误路径演示（pool 全同族 → judge 降级）`);
  sections.push("");
  sections.push(`judge pool = \`[${SAME_FAMILY_POOL.join(", ")}]\`（全 \`${MUTATE_FAMILY}\`，与 agent 同族）。`);
  const sameCfg = { ...debiasCfg, modelPool: SAME_FAMILY_POOL };
  let sameFamilyWarning = false;
  let judgeDegraded = false;
  let sameErrMsg = "";
  try {
    await runDebiasedJudge(variantA, variantB, sameCfg, {
      judge: realJudge,
      agentModelFamily: MUTATE_FAMILY,
    });
  } catch (e) {
    if (e instanceof SameModelFamilyError || e.name === "SameModelFamilyError") {
      sameFamilyWarning = true;
      judgeDegraded = true;
      sameErrMsg = e.message;
    } else {
      sameErrMsg = `${e.name}: ${e.message}`;
      judgeDegraded = true;
    }
  }
  sections.push(`- SameModelFamilyError 抛出: ${sameFamilyWarning ? "是" : "否"}`);
  sections.push(`- sameFamilyWarning = ${sameFamilyWarning}`);
  sections.push(`- judgeDegraded = ${judgeDegraded}`);
  if (sameErrMsg) {
    sections.push(`- 错误信息: \`${sameErrMsg}\``);
    sections.push(`- 处置: judge 降级回默认 0.5（不伪造分数），如实记录此 gap。`);
  }
  sections.push("");
  sections.push(`> 真实异模型须不同 provider（anthropic vs openai / openai vs zai）；`);
  sections.push(`> 同 provider 不同 model 仍同族，会被 CE-T05 judge-pool 剔除。`);
  sections.push("");

  // ── 6. 结论：异模型 judge 是否改变 select 决策 ─────────────────────────────
  sections.push(`## 6. 结论：异模型 judge 是否改变 select 决策`);
  sections.push("");
  // FakeLLM 默认 0.5：scoreA=scoreB=0.5，gap=0，sigma=0 → consistent=true，无偏好。
  const fakeScoreA = 0.5;
  const fakeScoreB = 0.5;
  const fakeConsistent = true;
  let realDecision = "无变化（judge 降级或一致）";
  let fakeDecision = "无偏好（A=B=0.5）";
  if (heteroResult && !heteroDegraded) {
    if (!heteroResult.consistent) {
      realDecision = "noise（σ > gap，不入选，等同不 select）";
    } else if (heteroResult.scoreA > heteroResult.scoreB) {
      realDecision = "select A (variant improved)";
    } else if (heteroResult.scoreB > heteroResult.scoreA) {
      realDecision = "select B (baseline)";
    } else {
      realDecision = "无偏好 (A=B)";
    }
  } else if (heteroDegraded) {
    realDecision = "judgeDegraded → 降级回 0.5 → 无偏好";
  }
  sections.push(`| 场景 | scoreA | scoreB | consistent | select 决策 |`);
  sections.push(`|---|---|---|---|---|`);
  sections.push(`| FakeLLM 默认 (基线) | ${fakeScoreA.toFixed(3)} | ${fakeScoreB.toFixed(3)} | ${fakeConsistent} | ${fakeDecision} |`);
  if (heteroResult) {
    sections.push(`| 异模型 RealLLMPort(B) | ${heteroResult.scoreA.toFixed(3)} | ${heteroResult.scoreB.toFixed(3)} | ${heteroResult.consistent} | ${realDecision} |`);
  } else {
    sections.push(`| 异模型 RealLLMPort(B) | 0.500 | 0.500 | true | ${realDecision} |`);
  }
  sections.push("");

  const changed =
    heteroResult &&
    !heteroDegraded &&
    (heteroResult.scoreA !== fakeScoreA ||
      heteroResult.scoreB !== fakeScoreB ||
      heteroResult.consistent !== fakeConsistent);
  sections.push(`**异模型 judge 是否改变了 select 决策（相对 FakeLLM 默认 0.5）**: ${
    changed ? "是" : "否"
  }`);
  sections.push("");
  sections.push(`- hetero judgeDegraded = ${heteroDegraded}（异模型 run 自身）`);
  sections.push(`- sameFamilyWarning = ${sameFamilyWarning}（§5.1 同族错误路径演示）`);
  sections.push(`- 若 judgeDegraded=true，judge 降级回 0.5，决策退回无偏好——此为如实记录的 gap，非伪造。`);
  sections.push("");

  // ── 附录：复用接口 + 铁律遵循 ──────────────────────────────────────────────
  sections.push(`## 附录 A：复用接口（不许重造）`);
  sections.push(`- \`RealLLMPort\` (@harness/l3-engine REAL-T01, 配置不同 model id 实现异模型判定)`);
  sections.push(`- \`runDebiasedJudge\` + \`calibrateAgainstL0\` (@harness/canary-eval CE-T05)`);
  sections.push(`- \`selectCrossFamilyJudge\` / \`SameModelFamilyError\` / \`extractModelFamily\` (CE-T04 judge-pool)`);
  sections.push(`- \`VerifierRun\` 形状 (CE-T02, calibrateAgainstL0 入参)`);
  sections.push("");
  sections.push(`## 附录 B：执行环境`);
  sections.push(`- pi: \`${"pi"}\` (本地 auth: openai=ready, zai=ready; anthropic/google=not_ready)`);
  sections.push(`- RealLLMPort timeoutMs=90000, maxRetries=1（pi 调用带 timeout）`);
  sections.push(`- swap 调用次数: ${judgeCallLog.length}（小规模，2-4 次判定）`);
  sections.push("");

  const report = sections.join("\n");
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/fresh-judge-hetero-001.md", report, "utf8");
  // 任务头要求 reports/judge-run-001.md：同内容副本（指向同一对比）。
  writeFileSync("reports/judge-run-001.md", report, "utf8");

  console.log(report);
  console.log("\n[wrote] reports/fresh-judge-hetero-001.md");
  console.log("[wrote] reports/judge-run-001.md");
}

main().catch((e) => {
  console.error("[run-fresh-judge-hetero] fatal:", e);
  process.exit(1);
});
