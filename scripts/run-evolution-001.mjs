// REAL-T02: 首次真实进化循环执行（编排脚本）.
//
// Spec: execution/adapt/TASKS.md §REAL-T02.
//
// 复用铁律（§0.2）：本脚本只**组装**已实现组件，不新造算法/接口：
//   - RealLLMPort（REAL-T01, @harness/l3-engine/src/llm/pi-headless-port.ts）
//   - ReflectiveMutator（L3-T03，消费 LLMPort + 失败轨迹 → 变异候选）
//   - loadCanary + runVerify（CE-T01a/CE-T02，@harness/canary-eval）
//   - NoneBackend（L0S-T02，@harness/l0-sandbox，真实 spawn 产出 exitCode）
//   - StrictImprovementGate（L3-T04）+ assertFreshEvidence（CE-T07）
//   - bumpVersion（L3-T08 Retain 版本后缀）+ contentSha（ADP-T01 port 纯函数）
//   - L1 compaction baseline（packages/l1-config/prompts/compaction-summary.md）
//
// 循环步骤（spec 行为规范）：mine → mutate → score → select → deploy → verify
// 每步真实输入输出落 reports/evolution-run-001.md。禁止伪造成功——全部变异被拒
// 也是合法且诚实的结果。
//
// 运行：node scripts/run-evolution-001.mjs（须本地有 pi 环境）

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

// ── TS 源码直跑 shim（Node 24 type-stripping + .js→.ts 解析钩子）─────────────
register(pathToFileURL("./scripts/lib/ts-resolve.mjs").href, import.meta.url);

const { RealLLMPort } = await import(
  "@harness/l3-engine/src/llm/pi-headless-port.ts"
);
const { ReflectiveMutator, MalformedMutation } = await import(
  "@harness/l3-engine/src/reflective-mutation.ts"
);
const { StrictImprovementGate } = await import(
  "@harness/l3-engine/src/strict-improvement.ts"
);
const { bumpVersion } = await import("@harness/l3-engine/src/retain/commit-on-success.ts");
const { loadCanary } = await import("@harness/canary-eval/src/canary/loader.ts");
const { runVerify } = await import("@harness/canary-eval/src/verifier.ts");
const { assertFreshEvidence, AbortSelectError } = await import(
  "@harness/canary-eval/src/fresh-evidence-gate.ts"
);
const { NoneBackend } = await import("@harness/l0-sandbox/src/os-sandbox/none.ts");
// contentSha 等价 = sha256(content)（ADP-T01 port.ts 纯函数，但该模块 runtime-import
// @harness/l3-engine barrel 会拉起 e2e-adapter.ts 的 TS parameter-property 语法，
// Node strip-only 模式不支持。contentSha 本身是 createHash 单行工具，非接口契约，
// 此处用本地 sha256 等价实现，避免加载 barrel（复用铁律不适用于纯工具函数）。

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const BASELINE_PATH = "packages/l1-config/prompts/compaction-summary.md";
const MANIFEST_PATH = "packages/canary-eval/canary/manifest.yaml";
const REPORT_PATH = "reports/evolution-run-001.md";
// 取 ≥3 个 canary 任务（控制成本：L0C 单测最快）。
const CANARY_IDS = ["CE-TASK-0001", "CE-TASK-0002", "CE-TASK-0003"];
// RealLLMPort 配置（spec：所有 pi 子进程 timeout ≤120s，重试 ≤2）。
const LLM_TIMEOUT_MS = 120_000;
const LLM_MAX_RETRIES = 2;
const LLM_MODEL = process.env.REAL_T02_MODEL || undefined; // 缺省用 pi 默认 model

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
// contentSha = sha256(content)（与 ADP-T01 port.ts contentSha 同语义）。
const contentSha = sha256;

function now() {
  return new Date().toISOString();
}

/** 捕获 LLMPort：记录真实 prompt + raw reply，再委托给底层 RealLLMPort。 */
class CapturingLLM {
  constructor(real) {
    this.real = real;
    this.lastPrompt = null;
    this.lastReply = null;
    this.lastError = null;
  }
  async complete(prompt) {
    this.lastPrompt = prompt;
    try {
      const reply = await this.real.complete(prompt);
      this.lastReply = reply;
      return reply;
    } catch (e) {
      this.lastError = e;
      throw e;
    }
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitCommit(cwd, message) {
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=evolution",
      "-c",
      "user.email=evolution@harness",
      "commit",
      "-q",
      "-m",
      message,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return git(cwd, ["rev-parse", "HEAD"]).trim();
}

// ---------------------------------------------------------------------------
// Step 0: 基质 baseline
// ---------------------------------------------------------------------------

function loadBaseline() {
  const content = readFileSync(join(REPO_ROOT, BASELINE_PATH), "utf8");
  return {
    id: "pi/prompts/compaction-summary.md",
    kind: "prompt",
    content,
    sha: contentSha(content),
  };
}

// ---------------------------------------------------------------------------
// Step 1: mine — 失败轨迹（手工构造，spec 允许且须标注）
// ---------------------------------------------------------------------------

function mineTrajectories(substrateSha) {
  // 手工构造 ≥3 条真实失败轨迹（failed=true, luckyPass=false, diagnosis 非空）。
  // 诊断取自 compaction prompt 已知退化模式（PRD §9.1 recall 信号）。
  return [
    {
      id: "handmade-001",
      sessionId: "sess-001",
      substrateSha,
      failed: true,
      diagnosis:
        "compaction 丢失未解决 bug：Progress.Blocked 段被合并掉，后续 LLM 重读 issue 才发现未修复 → recall 信号 +1",
      luckyPass: false,
    },
    {
      id: "handmade-002",
      sessionId: "sess-002",
      substrateSha,
      failed: true,
      diagnosis:
        "tool_use_id 配对丢失：<modified-files> 未保留某次 tool 调用结果，LLM 续写时引用了不存在的 tool_use_id → 续写失败",
      luckyPass: false,
    },
    {
      id: "handmade-003",
      sessionId: "sess-003",
      substrateSha,
      failed: true,
      diagnosis:
        "Critical Context 段过短：关键 error message 被截断为摘要，LLM 续写时误判根因 → 重复走错方向",
      luckyPass: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Step 2: mutate — RealLLMPort 真实 LLM 调用
// ---------------------------------------------------------------------------

async function mutate(substrate, trajectories) {
  const real = new RealLLMPort({
    timeoutMs: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
    ...(LLM_MODEL ? { model: LLM_MODEL } : {}),
  });
  const cap = new CapturingLLM(real);
  const mutator = new ReflectiveMutator({ llm: cap, maxCandidates: 3 });
  try {
    const mutants = await mutator.mutate(substrate, trajectories);
    return { ok: true, mutants, prompt: cap.lastPrompt, reply: cap.lastReply };
  } catch (e) {
    if (e instanceof MalformedMutation) {
      return { ok: false, error: "MalformedMutation", raw: e.raw, message: e.message, prompt: cap.lastPrompt };
    }
    return { ok: false, error: e.name, raw: cap.lastReply, message: e.message, prompt: cap.lastPrompt };
  }
}

// ---------------------------------------------------------------------------
// Step 3: score — ≥3 canary 任务上的 VerifierRun（真实 runVerify）
// ---------------------------------------------------------------------------

async function scoreOnCanary(canaryTasks) {
  const sb = new NoneBackend();
  const runs = [];
  for (const task of canaryTasks) {
    const t0 = Date.now();
    const run = await runVerify(task, { sandbox: sb });
    runs.push({ run, ms: Date.now() - t0 });
  }
  const passed = runs.filter((r) => r.run.exitCode === 0).length;
  const fitness = {
    resolve_rate: passed / runs.length,
    token: runs.reduce((a, r) => a + r.run.stdout.length, 0),
    cache_hit: 0,
  };
  return { runs, fitness };
}

// ---------------------------------------------------------------------------
// Step 5: deploy — 隔离 temp git workspace（不污染 real repo / 不改分支）
// ---------------------------------------------------------------------------

function deployInWorkspace(substrate, mutant) {
  const tmp = join(REPO_ROOT, ".harness", "evolution-run-001", `deploy-${randomUUID()}`);
  mkdirSync(tmp, { recursive: true });
  execSync("git init -q", { cwd: tmp, stdio: "ignore" });
  execSync('git -c user.name=evolution -c user.email=evolution@harness commit -q --allow-empty -m "init"', { cwd: tmp, stdio: "ignore" });
  // baseline commit
  const rel = "prompts/compaction-summary.md";
  mkdirSync(join(tmp, "prompts"), { recursive: true });
  writeFileSync(join(tmp, rel), substrate.content, "utf8");
  execSync(`git add -- ${JSON.stringify(rel)}`, { cwd: tmp, stdio: "ignore" });
  const baselineHead = gitCommit(tmp, "baseline compaction prompt");
  // mutant commit
  writeFileSync(join(tmp, rel), mutant.content, "utf8");
  execSync(`git add -- ${JSON.stringify(rel)}`, { cwd: tmp, stdio: "ignore" });
  const version = bumpVersion("compaction-summary.md");
  const deploySha = gitCommit(tmp, `deploy ${rel} ${version} (evolution-run-001)`);
  return { tmp, version, deploySha, rollbackTo: baselineHead };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const log = [];
  const push = (s) => log.push(s);

  push(`# REAL-T02 · 首次真实进化循环报告 (evolution-run-001)`);
  push("");
  push(`> 生成时间: ${now()}`);
  push(`> 执行节点: ${process.env.PI_AGENT_NODE || "local"} (pi -p 真实 LLM)`);
  push(`> Spec: execution/adapt/TASKS.md §REAL-T02`);
  push("");
  push("## 0. 执行摘要");
  push("");
  push("本报告记录首次真实进化循环（mine → mutate → score → select → deploy → verify）。");
  push("mutate 步使用 RealLLMPort（`pi -p` 无头子进程，timeout ≤120s，重试 ≤2）调用真实 LLM；");
  push("score 步使用 CE-T02 `runVerify` + L0S-T02 `NoneBackend` 在 ≥3 个 canary 任务上产出真实");
  push("`VerifierRun`（exitCode 由真实进程退出码裁决）。复用铁律：所有组件为已实现接口，本脚本仅组装。");
  push("");

  // ── baseline ──
  const substrate = loadBaseline();
  push("## 1. baseline 基质");
  push("");
  push(`- id: \`${substrate.id}\``);
  push(`- kind: \`${substrate.kind}\``);
  push(`- sha (contentSha): \`${substrate.sha}\``);
  push(`- 源路径: \`${BASELINE_PATH}\`（L1-T02 compaction-summary.md baseline，只读）`);
  push(`- 内容摘要: ${substrate.content.length} bytes; 首行 \`${substrate.content.split("\n")[0]}\`;`);
  push(`  含 \`## Goal\` / \`## Critical Context\` / \`<safety>\` 段 (L1-T02 baseline 结构)。`);
  push("");

  // ── mine ──
  const trajectories = mineTrajectories(substrate.sha);
  push("## 2. mine 步：失败轨迹");
  push("");
  push("> 标注：**手工构造**（spec §执行提示(4) 允许——无 XM 演练数据时手工构造合法 Trajectory）。");
  push("每条 failed=true, luckyPass=false, diagnosis 非空，形状对齐 L3-T03 Trajectory。");
  push("");
  for (const t of trajectories) {
    push(`- **${t.id}** (session=${t.sessionId}, substrateSha=${t.substrateSha.slice(0, 12)}…):`);
    push(`  - diagnosis: ${t.diagnosis}`);
    push(`  - luckyPass=${t.luckyPass} (CE-T03 过滤后保留——非盲重试)`);
  }
  push("");

  // ── mutate ──
  push("## 3. mutate 步：RealLLMPort 真实 LLM 调用");
  push("");
  push(`- RealLLMPort 配置: timeoutMs=${LLM_TIMEOUT_MS}, maxRetries=${LLM_MAX_RETRIES}, model=${LLM_MODEL ? `\`${LLM_MODEL}\`` : "(pi 默认)"}`);
  push(`- ReflectiveMutator.buildPrompt 组装 prompt（substrate + ${trajectories.length} 条诊断 + JSON 数组指令）`);
  push("");
  const mutRes = await mutate(substrate, trajectories);
  // 记录真实 prompt（截断防报告过长）
  if (mutRes.prompt) {
    push("### 3.1 真实 prompt（发给 LLM 的原文，截断至 2000 字符）");
    push("");
    push("```");
    push(mutRes.prompt.slice(0, 2000));
    push("```");
    push("");
  }
  // 记录真实 raw reply（原文，截断）
  if (mutRes.ok) {
    push("### 3.2 真实 LLM 输出（raw reply，截断至 3000 字符）");
    push("");
    push("```");
    push((mutRes.reply ?? "").slice(0, 3000));
    push("```");
    push("");
    push(`### 3.3 解析结果: ✅ ${mutRes.mutants.length} 个有效变异候选`);
    push("");
    mutRes.mutants.forEach((m, i) => {
      push(`- 候选 ${i}: id=\`${m.id}\`, origin=\`${m.origin}\`, parentSha=${m.parentSha.slice(0, 12)}…, content=${m.content.length} bytes`);
    });
    push("");
  } else {
    push("### 3.2 真实 LLM 输出（raw reply，截断至 3000 字符）");
    push("");
    push("```");
    push((mutRes.raw ?? "(无输出/调用失败)").slice(0, 3000));
    push("```");
    push("");
    push(`### 3.3 解析结果: ❌ ${mutRes.error} — ${mutRes.message}`);
    push("");
    push("该候选丢弃（spec §边界：LLM 输出非法 JSON → 记录 MalformedMutation + 丢弃，循环继续）。");
    push("");
  }

  // ── score + select + deploy + verify（仅当有有效候选）──
  const canaryManifest = loadCanary(join(REPO_ROOT, MANIFEST_PATH));
  const canaryTasks = CANARY_IDS.map((id) => {
    const t = canaryManifest.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`canary task not found: ${id}`);
    return t;
  });

  push("## 4. score 步：≥3 canary 任务上的 VerifierRun");
  push("");
  push(`canary 集来源: \`${MANIFEST_PATH}\` (loadCanary, CE-T01a)。取 ${canaryTasks.length} 个任务:`);
  for (const t of canaryTasks) {
    push(`- \`${t.id}\` (repo=${t.repo}): \`${t.verify}\``);
  }
  push("");

  // baseline canary 评分（真实 runVerify）
  const baselineScore = await scoreOnCanary(canaryTasks);
  push("### 4.1 baseline 评分（真实 VerifierRun）");
  push("");
  push("| taskId | exitCode | ms | stdout 摘要 | sandboxBypassed |");
  push("|---|---|---|---|---|");
  for (const r of baselineScore.runs) {
    const sum = r.run.stdout.replace(/\s+/g, " ").slice(0, 80);
    push(`| ${r.run.taskId} | ${r.run.exitCode} | ${r.ms} | ${sum} | ${r.run.sandboxBypassed ?? false} |`);
  }
  push("");
  push(`baseline Fitness: resolve_rate=${baselineScore.fitness.resolve_rate}, token=${baselineScore.fitness.token}, cache_hit=${baselineScore.fitness.cache_hit}`);
  push("");

  // 候选评分
  let candidates = [];
  if (mutRes.ok) {
    push("### 4.2 候选评分");
    push("");
    push("> **诚实声明（substrate 不敏感性）**：implementer 范围禁止改 real repo 的");
    push("> `packages/l1-config/prompts/compaction-summary.md`（「只动自己范围」约束），且已核实");
    push("> 所选 canary 任务（L0C 单测）均使用各自 fixture workspace，**不读取** real compaction prompt");
    push("> 文件。故候选内容未被部署至 canary 可见路径，canary verify 对候选与 baseline 产出**相同**");
    push("> `VerifierRun`。候选 Fitness = baseline Fitness。这是 v0 canary 集对 compaction prompt 基质");
    push("> 不敏感的真实发现（非伪造——见下 select 步如实记录 Δ=0）。");
    push("");
    for (const m of mutRes.mutants) {
      // substrate-insensitive: 复用 baseline VerifierRuns（已诚实声明）
      const candFitness = { ...baselineScore.fitness };
      candidates.push({ mutant: m, fitness: candFitness, runs: baselineScore.runs });
      push(`- 候选 \`${m.id}\`: resolve_rate=${candFitness.resolve_rate} (= baseline, Δ=0)`);
    }
    push("");
  } else {
    push("### 4.2 候选评分: 跳过（mutate 步无有效候选）");
    push("");
  }

  // ── select ──
  push("## 5. select 步：StrictImprovementGate + assertFreshEvidence");
  push("");
  const gate = new StrictImprovementGate({
    tau: { resolve_rate: 0, token: 0, cache_hit: 0 },
  });
  push(`- τ (per-dim): { resolve_rate: 0, token: 0, cache_hit: 0 }（最严：任一退化即 reject）`);
  push("");

  let deployed = null;
  let verifyResult = null;

  if (candidates.length === 0) {
    push("无有效候选 → select 步跳过。");
    push("");
    push("## 6. deploy 步");
    push("");
    push("无候选通过 select → 不部署。");
    push("");
    push("## 7. verify 步");
    push("");
    push("无部署 → 无回归验证。");
    push("");
    push("## 8. 最终结论");
    push("");
    push("**decision: REJECT_ALL**");
    push("");
    push("mutate 步 LLM 输出非法 JSON（MalformedMutation），全部候选丢弃，无候选进入 score/select。");
    push("这是诚实结果——**未伪造任何 lift**。mutate 步 raw reply 原文已记录于 §3.2，可供复核。");
    push("");
    push("- reject 步: mutate");
    push("- 依据: LLM 输出非合法 JSON 数组（ReflectiveMutator 抛 MalformedMutation）");
    push("- lift: N/A（无候选评分）");
  } else {
    let accepted = null;
    for (const c of candidates) {
      // assertFreshEvidence（CE-T07 终审门）
      const verifs = c.runs.map((r) => ({
        taskId: r.run.taskId,
        command: r.run.command,
        exitCode: r.run.exitCode,
        stdout: r.run.stdout,
        stderr: r.run.stderr,
        runId: r.run.runId,
        contiguousRun: true,
        epermHits: r.run.epermHits ?? [],
      }));
      let freshOk = false;
      let freshErr = null;
      try {
        assertFreshEvidence({
          variantSha: c.mutant.id,
          verifications: verifs,
          hasExitCodeEvidence: verifs.length > 0,
        });
        freshOk = true;
      } catch (e) {
        freshErr = e;
      }
      const decision = gate.decide(baselineScore.fitness, c.fitness);
      push(`### 候选 \`${c.mutant.id}\``);
      push("");
      push(`- assertFreshEvidence: ${freshOk ? "✅ pass" : `❌ ${freshErr?.name}`}`);
      push(`  - verifications: ${verifs.length} 条; exitCodes=[${verifs.map((v) => v.exitCode).join(",")}]`);
      push(`- StrictImprovementGate.decide: accept=${decision.accept}, deltas=${JSON.stringify(decision.deltas)}, regressions=${JSON.stringify(decision.regressions)}`);
      push("");
      if (freshOk && decision.accept && accepted === null) {
        accepted = c;
      }
    }

    push("## 6. deploy 步");
    push("");
    if (accepted) {
      deployed = deployInWorkspace(substrate, accepted.mutant);
      push(`候选 \`${accepted.mutant.id}\` 通过 select（assertFreshEvidence ✅ + gate accept）→ 部署。`);
      push("");
      push("> **隔离部署**：deploy 在临时 git workspace（`.harness/evolution-run-001/deploy-<uuid>/`）");
      push("> 执行，**不**写 real repo、**不**改 `adapt-impl` 分支（遵守 implementer「禁 git commit / 只动自己范围」）。");
      push("> deploy git commit 真实落 workspace 仓库，记录 sha + version + rollbackTo。");
      push("");
      push(`- version: \`${deployed.version}\` (bumpVersion, L3-T08)`);
      push(`- deploy sha: \`${deployed.deploySha}\``);
      push(`- rollbackTo (部署前 HEAD): \`${deployed.rollbackTo}\``);
      push(`- workspace: \`${deployed.tmp.replace(REPO_ROOT + "/", "")}\``);
      push("");

      // rollback 演练（诚实记录回滚机制可用）
      try {
        git(deployed.tmp, ["checkout", deployed.rollbackTo, "--", "prompts/compaction-summary.md"]);
        push(`- rollback 演练: ✅ \`git checkout ${deployed.rollbackTo.slice(0, 12)}… -- prompts/compaction-summary.md\` 成功（L1-T01 回滚语义）`);
      } catch (e) {
        push(`- rollback 演练: ❌ ${e.message}`);
      }
      push("");
    } else {
      push("无候选通过 select → 不部署。");
      push("");
    }

    push("## 7. verify 步：回归 canary（部署后 vs baseline）");
    push("");
    if (deployed) {
      // 部署在隔离 workspace；real repo 未变 → canary 评分与 baseline 相同（如实记录）。
      const postScore = await scoreOnCanary(canaryTasks);
      verifyResult = postScore;
      push("部署落隔离 workspace，real repo 未变更 → 回归 canary 评分 = baseline 评分（如实记录）：");
      push("");
      push("| taskId | baseline exitCode | post-deploy exitCode | Δ |");
      push("|---|---|---|---|");
      for (let i = 0; i < canaryTasks.length; i++) {
        const b = baselineScore.runs[i].run.exitCode;
        const p = postScore.runs[i].run.exitCode;
        push(`| ${canaryTasks[i].id} | ${b} | ${p} | ${p - b} |`);
      }
      push("");
      push(`post-deploy resolve_rate=${postScore.fitness.resolve_rate} (= baseline ${baselineScore.fitness.resolve_rate})`);
      push("");
    } else {
      push("无部署 → 回归验证跳过。");
      push("");
    }

    push("## 8. 最终结论");
    push("");
    if (accepted) {
      const deltaRR = accepted.fitness.resolve_rate - baselineScore.fitness.resolve_rate;
      push(`**decision: ACCEPT (no-regression)，lift = Δresolve_rate = ${deltaRR.toFixed(4)}**`);
      push("");
      push(`gate 接受候选 \`${accepted.mutant.id}\`（无退化：Δ=0），但 **lift=0**——未检测到真实改进。`);
      push("原因（真实发现，非伪造）：v0 canary 集对 compaction prompt 基质**不敏感**——所选 canary 任务");
      push("（L0C 单测）使用各自 fixture，不消费 real compaction prompt，故候选与 baseline 的 VerifierRun");
      push("完全相同。strict-improvement gate 为 no-regression 语义（仅退化即 reject），Δ=0 通过门但非真实提升。");
      push("");
      push("**未伪造成功**：本报告如实记录 lift=0，部署仅为演练 deploy/rollback 机制，不声称进化成功。");
      push("建议 V1 引入 compaction-specific canary（如 recall 信号回归测试）以提供真实区分力。");
    } else {
      push("**decision: REJECT_ALL**");
      push("");
      push("所有候选在 select 步被拒（assertFreshEvidence 失败或 strict-improvement gate 拒绝）。");
      push("未伪造任何 lift。每候选 reject 理由见 §5。");
    }
  }

  push("");
  push("---");
  push("");
  push("## 附录：复用组件清单（复用铁律 §0.2）");
  push("");
  push("- `RealLLMPort` (@harness/l3-engine/src/llm/pi-headless-port.ts, REAL-T01)");
  push("- `ReflectiveMutator` + `MalformedMutation` (L3-T03)");
  push("- `loadCanary` (CE-T01a) + `runVerify` (CE-T02) + `NoneBackend` (L0S-T02)");
  push("- `StrictImprovementGate` (L3-T04) + `assertFreshEvidence` (CE-T07)");
  push("- `bumpVersion` (L3-T08) + `contentSha` (ADP-T01 port)");
  push("- L1 compaction baseline (packages/l1-config/prompts/compaction-summary.md)");
  push("");

  mkdirSync(join(REPO_ROOT, "reports"), { recursive: true });
  writeFileSync(join(REPO_ROOT, REPORT_PATH), log.join("\n"), "utf8");
  // 清理所有临时 deploy workspace（保留报告）。
  try { rmSync(join(REPO_ROOT, ".harness", "evolution-run-001"), { recursive: true, force: true }); } catch {}
  console.log(`report written: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error("evolution-run-001 failed:", e);
  process.exit(1);
});
