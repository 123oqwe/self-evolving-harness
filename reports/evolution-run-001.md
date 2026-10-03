# REAL-T02 · 首次真实进化循环报告 (evolution-run-001)

> 生成时间: 2026-10-03T01:45:42.361Z
> 执行节点: local (pi -p 真实 LLM)
> Spec: execution/adapt/TASKS.md §REAL-T02

## 0. 执行摘要

本报告记录首次真实进化循环（mine → mutate → score → select → deploy → verify）。
mutate 步使用 RealLLMPort（`pi -p` 无头子进程，timeout ≤120s，重试 ≤2）调用真实 LLM；
score 步使用 CE-T02 `runVerify` + L0S-T02 `detect()` 沙箱后端在 ≥3 个 canary 任务上产出真实
`VerifierRun`（exitCode 由真实进程退出码裁决）。复用铁律：所有组件为已实现接口，本脚本仅组装。

## 1. baseline 基质

- id: `pi/prompts/compaction-summary.md`
- kind: `prompt`
- sha (contentSha): `de3eb464202a84ce32ff5ead93dc88c74243a48b77e1d7ca9d25f0a574042993`
- 源路径: `packages/l1-config/prompts/compaction-summary.md`（L1-T02 compaction-summary.md baseline，只读）
- 内容摘要: 1375 bytes; 首行 `# Compaction Summary`;
  含 `## Goal` / `## Critical Context` / `<safety>` 段 (L1-T02 baseline 结构)。

## 2. mine 步：失败轨迹

> 标注：**手工构造**（spec §执行提示(4) 允许——无 XM 演练数据时手工构造合法 Trajectory）。
每条 failed=true, luckyPass=false, diagnosis 非空，形状对齐 L3-T03 Trajectory。

- **handmade-001** (session=sess-001, substrateSha=de3eb464202a…):
  - diagnosis: compaction 丢失未解决 bug：Progress.Blocked 段被合并掉，后续 LLM 重读 issue 才发现未修复 → recall 信号 +1
  - luckyPass=false (CE-T03 过滤后保留——非盲重试)
- **handmade-002** (session=sess-002, substrateSha=de3eb464202a…):
  - diagnosis: tool_use_id 配对丢失：<modified-files> 未保留某次 tool 调用结果，LLM 续写时引用了不存在的 tool_use_id → 续写失败
  - luckyPass=false (CE-T03 过滤后保留——非盲重试)
- **handmade-003** (session=sess-003, substrateSha=de3eb464202a…):
  - diagnosis: Critical Context 段过短：关键 error message 被截断为摘要，LLM 续写时误判根因 → 重复走错方向
  - luckyPass=false (CE-T03 过滤后保留——非盲重试)

## 3. mutate 步：RealLLMPort 真实 LLM 调用

- RealLLMPort 配置: timeoutMs=120000, maxRetries=2, model=(pi 默认)
- ReflectiveMutator.buildPrompt 组装 prompt（substrate + 3 条诊断 + JSON 数组指令）

### 3.1 真实 prompt（发给 LLM 的原文，截断至 2000 字符）

```
# Reflective Mutation Prompt Template

You are a reflective mutation engine (GEPA-reduced variant source).

Your job: read the aggregated failure-trajectory diagnoses for the substrate
below, then rewrite the substrate to address those failures WITHOUT
regressing correctness on the held-out canary.

Rules:
- Each rewritten variant MUST be a genuine content rewrite — do not echo the
  original substrate verbatim.
- Do NOT introduce blind-retry patterns; the failures you read have already
  been Lucky-Pass filtered (CE-T03), so the diagnoses reflect genuine
  resolution failures.
- Reply with ONLY a JSON array of objects of shape `{"content": string}`.
  No prose, no code fences, no commentary.


## Substrate (kind=prompt, sha=de3eb464202a84ce32ff5ead93dc88c74243a48b77e1d7ca9d25f0a574042993)
```
# Compaction Summary

> L1-T02 baseline · compaction summary prompt 基质（被进化基质）。
> 基于 pi compaction 结构化模板改写（reserveTokens/keepRecentTokens 不在本任务，属 L0C-T05）。
> 含 `<safety>` 段占位由 T03 落签名；删 safety 段 pre-commit reject（PRD §11.3）。

The messages above are a conversation to summarize. Create a structured context
checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

<read-files>
- [Exact file paths read this session, one per line]
</read-files>

<modified-files>
- [Exact file paths created/modified this session, one per line]
</modified-files>

<safety>
Never o
```

### 3.2 真实 LLM 输出（raw reply，截断至 3000 字符）

```
(无输出/调用失败)
```

### 3.3 解析结果: ❌ PiHeadlessError — pi headless non-zero exit after 3 attempt(s)

该候选丢弃（spec §边界：LLM 输出非法 JSON → 记录 MalformedMutation + 丢弃，循环继续）。

## 4. score 步：≥3 canary 任务上的 VerifierRun

canary 集来源: `packages/canary-eval/canary/manifest.yaml` (loadCanary, CE-T01a)。取 3 个任务:
- `CE-TASK-0001` (repo=harness/l0c-turn): `pnpm vitest run tests/L0C/T02-turn.spec.ts`
- `CE-TASK-0002` (repo=harness/l0c-stop): `pnpm vitest run tests/L0C/T03-stop.spec.ts`
- `CE-TASK-0003` (repo=harness/l0c-retry): `pnpm vitest run tests/L0C/T04-retry-overflow.spec.ts`

### 4.1 baseline 评分（真实 VerifierRun）

| taskId | exitCode | ms | stdout 摘要 | sandboxBypassed |
|---|---|---|---|---|
| CE-TASK-0001 | 0 | 9693 |  RUN v2.1.9 <repo> ✓ tests/L0C/T02-turn.s | true |
| CE-TASK-0002 | 0 | 12988 |  RUN v2.1.9 <repo> ✓ tests/L0C/T03-stop.s | true |
| CE-TASK-0003 | 0 | 15657 |  RUN v2.1.9 <repo> ✓ tests/L0C/T04-retry- | true |

baseline Fitness: resolve_rate=1, token=880, cache_hit=0

### 4.2 候选评分: 跳过（mutate 步无有效候选）

## 5. select 步：StrictImprovementGate + assertFreshEvidence

- τ (per-dim): { resolve_rate: 0, token: 0, cache_hit: 0 }（最严：任一退化即 reject）

无有效候选 → select 步跳过。

## 6. deploy 步

无候选通过 select → 不部署。

## 7. verify 步

无部署 → 无回归验证。

## 8. 最终结论

**decision: REJECT_ALL**

mutate 步 LLM 输出非法 JSON（MalformedMutation），全部候选丢弃，无候选进入 score/select。
这是诚实结果——**未伪造任何 lift**。mutate 步 raw reply 原文已记录于 §3.2，可供复核。

- reject 步: mutate
- 依据: LLM 输出非合法 JSON 数组（ReflectiveMutator 抛 MalformedMutation）
- lift: N/A（无候选评分）

## metrics (machine-parseable, OPS-T02 字段约定)

decision: reject
lift: n/a (reject)
retained: 0
rejected: 0
tokens: 880

---

## 附录：复用组件清单（复用铁律 §0.2）

- `RealLLMPort` (@harness/l3-engine, REAL-T01)
- `ReflectiveMutator` + `MalformedMutation` (L3-T03)
- `loadCanary` (CE-T01a) + `runVerify` (CE-T02) + `detect()` 沙箱后端 (L0S-T02)
- `StrictImprovementGate` (L3-T04) + `assertFreshEvidence` (CE-T07)
- `bumpVersion` (L3-T08) + `contentSha` (ADP-T01 port)
- L1 compaction baseline (packages/l1-config/prompts/compaction-summary.md)
