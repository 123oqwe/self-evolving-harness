# REAL-T03 异模型 fresh judge 对比报告 (fresh-judge-hetero-001)

> 生成时间: 2026-09-23T21:31:07.251Z
> 编排脚本: scripts/run-fresh-judge-hetero.mjs
> 复用: RealLLMPort (REAL-T01) + runDebiasedJudge/calibrateAgainstL0 (CE-T05) + judge-pool (CE-T04)

## 1. 模型配置（异模型判定）

| 角色 | model id | provider(family) |
|---|---|---|
| mutate model (A) | `openai/gpt-4o-mini` | `openai` |
| judge model (B) | `zai/glm-4.7` | `zai` |

- **异模型判定**: 是（A、B 不同 provider = 真异模型族）
- judge pool = `[zai/glm-4.7]`

## 2. variant / baseline 内容摘要

**variant A (improved, sha=variant-improved-0001):**
```
Summarize the conversation history into a structured brief with sections: (1) Decisions Made, (2) Open Questions, (3) Next Actions, (4) Key Constraints. Be concise. Preserve exact identifiers and file paths. Do not invent facts not present in the history.
```

**baseline B (sha=baseline-0000):**
```
Summarize the conversation history. Keep it concise. Include key decisions and open questions.
```

## 3. 异模型 judge 评分（position swap A/B + 去偏综合分）

judge = RealLLMPort(`zai/glm-4.7`)，timeoutMs=90000，swap A/B 两轮共 4 次调用。

### 3.1 逐次 judge 调用记录（raw 输出如实记录）

| # | position | variant | score | degraded | raw 输出 |
|---|---|---|---|---|---|
| 1 | A | variant-improved-0001 | 0.870 | 否 | `0.87 ` |
| 2 | B | baseline-0000 | 0.600 | 否 | `0.6 ` |
| 3 | B | variant-improved-0001 | 0.870 | 否 | `0.87 ` |
| 4 | A | baseline-0000 | 0.550 | 否 | `0.55 ` |

### 3.2 去偏综合分

| 指标 | 值 |
|---|---|
| A 位评分 (scoreA, variant 均值) | 0.870 |
| B 位评分 (scoreB, baseline 均值) | 0.575 |
| position-bias σ (跨轮 a-b 差值总体标准差) | 0.025 |
| 声称 gap \|scoreA-scoreB\| | 0.295 |
| consistent (σ <= gap) | true |

> swap = position 互换两轮：round1 a@A/b@B、round2 a@B/b@A；scoreA/scoreB = 各自两轮均值。

## 4. 与机械 canary exitCode 的一致性 (calibrateAgainstL0)

机械 L0 裁决 fixture（VerifierRun.exitCode）：

| taskId | exitCode | 含义 |
|---|---|---|
| canary-compaction-001 | 0 | pass |
| canary-compaction-000 | 1 | fail |

- judge.consistent = true（variant A 改写版对 should-pass canary）
- L0 exitCode===0 = true（A 通过）→ 同向 → 一致
- **calibrateAgainstL0 accuracy = 1.000** (一致判定数/总数)

## 5. 同族判定 (agentModelFamily / sameFamily)

- mutate/agent family = `openai`
- judge family = `zai`
- 同族风险: 否（异族，judge 未被剔除）

### 5.1 同族错误路径演示（pool 全同族 → judge 降级）

judge pool = `[openai/gpt-4o, openai/gpt-4.1]`（全 `openai`，与 agent 同族）。
- SameModelFamilyError 抛出: 是
- sameFamilyWarning = true
- judgeDegraded = true
- 错误信息: `no cross-family judge available: all judges in pool [openai/gpt-4o, openai/gpt-4.1] share agent family "openai"`
- 处置: judge 降级回默认 0.5（不伪造分数），如实记录此 gap。

> 真实异模型须不同 provider（anthropic vs openai / openai vs zai）；
> 同 provider 不同 model 仍同族，会被 CE-T05 judge-pool 剔除。

## 6. 结论：异模型 judge 是否改变 select 决策

| 场景 | scoreA | scoreB | consistent | select 决策 |
|---|---|---|---|---|
| FakeLLM 默认 (基线) | 0.500 | 0.500 | true | 无偏好（A=B=0.5） |
| 异模型 RealLLMPort(B) | 0.870 | 0.575 | true | select A (variant improved) |

**异模型 judge 是否改变了 select 决策（相对 FakeLLM 默认 0.5）**: 是

- hetero judgeDegraded = false（异模型 run 自身）
- sameFamilyWarning = true（§5.1 同族错误路径演示）
- 若 judgeDegraded=true，judge 降级回 0.5，决策退回无偏好——此为如实记录的 gap，非伪造。

## 附录 A：复用接口（不许重造）
- `RealLLMPort` (@harness/l3-engine REAL-T01, 配置不同 model id 实现异模型判定)
- `runDebiasedJudge` + `calibrateAgainstL0` (@harness/canary-eval CE-T05)
- `selectCrossFamilyJudge` / `SameModelFamilyError` / `extractModelFamily` (CE-T04 judge-pool)
- `VerifierRun` 形状 (CE-T02, calibrateAgainstL0 入参)

## 附录 B：执行环境
- pi: `pi` (本地 auth: openai=ready, zai=ready; anthropic/google=not_ready)
- RealLLMPort timeoutMs=90000, maxRetries=1（pi 调用带 timeout）
- swap 调用次数: 4（小规模，2-4 次判定）
