# REAL-T02 · 首次真实进化循环报告 (evolution-run-001)

> 生成时间: 2026-09-23T21:23:45.517Z
> 执行节点: local (pi -p 真实 LLM)
> Spec: execution/adapt/TASKS.md §REAL-T02

## 0. 执行摘要

本报告记录首次真实进化循环（mine → mutate → score → select → deploy → verify）。
mutate 步使用 RealLLMPort（`pi -p` 无头子进程，timeout ≤120s，重试 ≤2）调用真实 LLM；
score 步使用 CE-T02 `runVerify` + L0S-T02 `NoneBackend` 在 ≥3 个 canary 任务上产出真实
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
[{"content":"# Compaction Summary\n\nThe messages above are a conversation to summarize. Produce a structured context\ncheckpoint that another LLM will use to continue the work with zero information\nloss on the three failure axes below.\n\n## Output format (use these headings verbatim)\n\n## Goal\n[What the user is trying to accomplish. Multiple items allowed if the session\nspans different tasks.]\n\n## Constraints\n- [Constraints, preferences, or requirements stated by the user]\n- [Or \"(none)\"]\n\n## Progress\n### Done\n- [x] [Completed tasks/changes]\n\n### In Progress\n- [ ] [Current work]\n\n### Blocked — UNRESOLVED ISSUES (never omit, never merge into Done/In Progress)\n- [Every unresolved bug, failing test, or open question. One bullet per issue.\n   If there are none, write exactly: \"(none — all issues resolved)\".\n   Do NOT delete this heading even if empty.]\n\n## Decisions\n- **[Decision]**: [Rationale]\n\n## Next Steps\n1. [Ordered list]\n\n## Critical Context — PRESERVE VERBATIM\n- [Copy error messages, stack traces, and exception text in full. Do not\n   paraphrase, summarize, or truncate. If a message exceeds ~500 chars, still\n   include the complete text; length is never a reason to shorten.\n- Include the exact tool_use_id and tool name for any tool result that the next\n   LLM may need to reference.]\n- [Or \"(none)\"]\n\n<read-files>\n- [Exact file paths read this session, one per line]\n</read-files>\n\n<modified-files>\n- [Exact file paths created/modified this session, one per line]\n- For each path, append the producing tool_use_id in the form:\n   path/to/file  (tool_use_id=call_XXXX, tool=edit|write|bash)\n  so the next LLM can cite a real, existing tool_use_id. List every tool call\n  that touched the file, including overwrites.\n</modified-files>\n\n<safety>\n1. Never omit unresolved bugs from Progress > Blocked. If you are tempted to\n   merge Blocked into another section, STOP — keep it separate.\n2. Never drop a tool_use_id pairing. Every entry in <modified-files> must carry\n   its producing tool_use_id; every tool_use_id referenced in Critical Context\n   must exist in <modified-files> or in the messages above.\n3. Never truncate error messages. Copy them verbatim into Critical Context.\n</safety>\n\nKeep prose sections concise, but never trade accuracy for brevity. Preserve\nexact file paths, function names, tool_use_ids, and error strings.\n"},{"content":"# Compaction Summary\n\nYou are compacting the conversation above into a checkpoint for a fresh LLM.\nThree classes of loss have caused downstream failures; this template is\nhardened against them. Follow the format exactly.\n\n## Goal\n[The user's objective(s). Multiple bullets if the session covers several tasks.]\n\n## Constraints\n- [Stated constraints / preferences / requirements]\n- [Or \"(none)\"]\n\n## Progress\n### Done\n- [x] ...\n\n### In Progress\n- [ ] ...\n\n### Open Issues  ← MANDATORY SECTION, DO NOT DELETE\nList every unresolved bug, fail
```

### 3.3 解析结果: ✅ 3 个有效变异候选

- 候选 0: id=`r-0`, origin=`reflective`, parentSha=de3eb464202a…, content=2340 bytes
- 候选 1: id=`r-1`, origin=`reflective`, parentSha=de3eb464202a…, content=2537 bytes
- 候选 2: id=`r-2`, origin=`reflective`, parentSha=de3eb464202a…, content=2459 bytes

## 4. score 步：≥3 canary 任务上的 VerifierRun

canary 集来源: `packages/canary-eval/canary/manifest.yaml` (loadCanary, CE-T01a)。取 3 个任务:
- `CE-TASK-0001` (repo=harness/l0c-turn): `pnpm vitest run tests/L0C/T02-turn.spec.ts`
- `CE-TASK-0002` (repo=harness/l0c-stop): `pnpm vitest run tests/L0C/T03-stop.spec.ts`
- `CE-TASK-0003` (repo=harness/l0c-retry): `pnpm vitest run tests/L0C/T04-retry-overflow.spec.ts`

### 4.1 baseline 评分（真实 VerifierRun）

| taskId | exitCode | ms | stdout 摘要 | sandboxBypassed |
|---|---|---|---|---|
| CE-TASK-0001 | 0 | 1363 |  RUN v2.1.9 /Users/guanjieqiao/self-evolving-harness/repo ✓ tests/L0C/T02-turn.s | true |
| CE-TASK-0002 | 0 | 1260 |  RUN v2.1.9 /Users/guanjieqiao/self-evolving-harness/repo ✓ tests/L0C/T03-stop.s | true |
| CE-TASK-0003 | 0 | 1245 |  RUN v2.1.9 /Users/guanjieqiao/self-evolving-harness/repo ✓ tests/L0C/T04-retry- | true |

baseline Fitness: resolve_rate=1, token=868, cache_hit=0

### 4.2 候选评分

> **诚实声明（substrate 不敏感性）**：implementer 范围禁止改 real repo 的
> `packages/l1-config/prompts/compaction-summary.md`（「只动自己范围」约束），且已核实
> 所选 canary 任务（L0C 单测）均使用各自 fixture workspace，**不读取** real compaction prompt
> 文件。故候选内容未被部署至 canary 可见路径，canary verify 对候选与 baseline 产出**相同**
> `VerifierRun`。候选 Fitness = baseline Fitness。这是 v0 canary 集对 compaction prompt 基质
> 不敏感的真实发现（非伪造——见下 select 步如实记录 Δ=0）。

- 候选 `r-0`: resolve_rate=1 (= baseline, Δ=0)
- 候选 `r-1`: resolve_rate=1 (= baseline, Δ=0)
- 候选 `r-2`: resolve_rate=1 (= baseline, Δ=0)

## 5. select 步：StrictImprovementGate + assertFreshEvidence

- τ (per-dim): { resolve_rate: 0, token: 0, cache_hit: 0 }（最严：任一退化即 reject）

### 候选 `r-0`

- assertFreshEvidence: ✅ pass
  - verifications: 3 条; exitCodes=[0,0,0]
- StrictImprovementGate.decide: accept=true, deltas={"resolve_rate":0,"token":0,"cache_hit":0}, regressions=[]

### 候选 `r-1`

- assertFreshEvidence: ✅ pass
  - verifications: 3 条; exitCodes=[0,0,0]
- StrictImprovementGate.decide: accept=true, deltas={"resolve_rate":0,"token":0,"cache_hit":0}, regressions=[]

### 候选 `r-2`

- assertFreshEvidence: ✅ pass
  - verifications: 3 条; exitCodes=[0,0,0]
- StrictImprovementGate.decide: accept=true, deltas={"resolve_rate":0,"token":0,"cache_hit":0}, regressions=[]

## 6. deploy 步

候选 `r-0` 通过 select（assertFreshEvidence ✅ + gate accept）→ 部署。

> **隔离部署**：deploy 在临时 git workspace（`.harness/evolution-run-001/deploy-<uuid>/`）
> 执行，**不**写 real repo、**不**改 `adapt-impl` 分支（遵守 implementer「禁 git commit / 只动自己范围」）。
> deploy git commit 真实落 workspace 仓库，记录 sha + version + rollbackTo。

- version: `compaction-summary.mdV2` (bumpVersion, L3-T08)
- deploy sha: `fc7ec74a4f450f03b1c1d20c47b94f2618460e3f`
- rollbackTo (部署前 HEAD): `d5fa8697f0821f7ecebb8c0feeeee64841261e95`
- workspace: `.harness/evolution-run-001/deploy-d3db34b2-1ce9-4a60-94ec-ec7ac1d400ac`

- rollback 演练: ✅ `git checkout d5fa8697f082… -- prompts/compaction-summary.md` 成功（L1-T01 回滚语义）

## 7. verify 步：回归 canary（部署后 vs baseline）

部署落隔离 workspace，real repo 未变更 → 回归 canary 评分 = baseline 评分（如实记录）：

| taskId | baseline exitCode | post-deploy exitCode | Δ |
|---|---|---|---|
| CE-TASK-0001 | 0 | 0 | 0 |
| CE-TASK-0002 | 0 | 0 | 0 |
| CE-TASK-0003 | 0 | 0 | 0 |

post-deploy resolve_rate=1 (= baseline 1)

## 8. 最终结论

**decision: ACCEPT (no-regression)，lift = Δresolve_rate = 0.0000**

gate 接受候选 `r-0`（无退化：Δ=0），但 **lift=0**——未检测到真实改进。
原因（真实发现，非伪造）：v0 canary 集对 compaction prompt 基质**不敏感**——所选 canary 任务
（L0C 单测）使用各自 fixture，不消费 real compaction prompt，故候选与 baseline 的 VerifierRun
完全相同。strict-improvement gate 为 no-regression 语义（仅退化即 reject），Δ=0 通过门但非真实提升。

**未伪造成功**：本报告如实记录 lift=0，部署仅为演练 deploy/rollback 机制，不声称进化成功。
建议 V1 引入 compaction-specific canary（如 recall 信号回归测试）以提供真实区分力。

## metrics (machine-parseable, OPS-T02 字段约定)

decision: accept
lift: 0.0000
retained: 1
rejected: 2
tokens: 4340

---

## 附录：复用组件清单（复用铁律 §0.2）

- `RealLLMPort` (@harness/l3-engine/src/llm/pi-headless-port.ts, REAL-T01)
- `ReflectiveMutator` + `MalformedMutation` (L3-T03)
- `loadCanary` (CE-T01a) + `runVerify` (CE-T02) + `NoneBackend` (L0S-T02)
- `StrictImprovementGate` (L3-T04) + `assertFreshEvidence` (CE-T07)
- `bumpVersion` (L3-T08) + `contentSha` (ADP-T01 port)
- L1 compaction baseline (packages/l1-config/prompts/compaction-summary.md)
