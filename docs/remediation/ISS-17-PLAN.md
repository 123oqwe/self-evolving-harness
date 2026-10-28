# ISS-17 修复规划（TDD：规划 → 测试 → 代码 → 云端 CI → PR）

## 客观事实（已核实）
评审 ISS-17 指「同一概念多份重复实现」，实证为两类：

### A. 6 处 `*StrictImprovementGate` 语义不一致（真问题，影响最大）
| 门 | 位置 | Δ=0 行为 |
|---|---|---|
| contextModeStrictImprovementGate | `context-mode-router.ts:134` | **放行** ❌ |
| reducerStrictImprovementGate | `reducer-partition.ts:114` | **放行** ❌ |
| DelegationSubstrate.strictImprovementGate | `delegation-substrate.ts:229` | **放行** ❌ |
| recoveryStrictImprovementGate | `failure-recovery.ts:135` | 拒绝 ✅ |
| hookStrictImprovementGate | `hook-evolution.ts:307` | 拒绝 ✅ |
| steeringStrictImprovementGate | `steering-policy.ts:117` | 拒绝 ✅ |

ISS-01 只修了 l3-engine 一处；l1 中 3 处仍是「不退化为过」的旧语义 →
同一个「严格改进」规则在不同 substrate 上结论相反。

### B. 三份 `breaker.ts`（核实为**职责不同**，非重复）
- `l0-core/src/guard/breaker.ts`：L0C-T10 apply-time 运行时断路器（pre-commit 的运行时镜像）
- `l3-engine/src/breaker.ts`：L3 侧只读不变量强制（进化入口 + sandbox EPERM）
- `l0-sandbox/src/action-classifier/breaker.ts`：action 分类器 `assertBreaker`

按 spec「语义不同则改名以区分职责」——三者分层明确，**改名会波及 3 包导出**，
故采取「文档化区分职责」+ 不合并（最小且诚实的处理，写入本文件与 README 说明）。

## 修复步骤（严格 TDD）

### 步骤 1：写失败测试
`tests/L1/ISS17-gate-consistency.spec.ts`（新）：
- 对 6 个门逐一声明式断言：**Δ=0（完全无变化）必须 reject**；
- 断言「任一指标退化 > τ → reject」在 6 个门一致；
- 断言「至少一项严格改善 → accept」在 6 个门一致。

预期 RED：3 个旧语义门在 Δ=0 时返回 true。

### 步骤 2：实现
1. `packages/contracts/src/` 新增纯函数
   `strictImprovement(deltas: number[], tau: number): boolean`：
   - `deltas.some(d => d < -tau)` → false（任一退化超 τ）
   - 否则 `deltas.some(d => d > 0)`（至少一项严格改善，排除 Δ=0）
   - `delta` 定义为「候选 - 基线，且已换算为越大越好方向」。
2. 3 个旧语义门改为薄包装（各自把 fitness 映射为 deltas 后调用通用函数）：
   - contextMode: `[cand.acceptanceInBudget - base.acceptanceInBudget, base.redoRate - cand.redoRate]`
   - reducer: `[cand.mergeConsistency - base.mergeConsistency, cand.partitionDisjointRate - base.partitionDisjointRate]`
   - delegation: `[cand.acceptanceRate - base.acceptanceRate, base.reDispatchRate - cand.reDispatchRate]`
3. 3 个已正确门保持不变（若与通用规则等价，可后续收敛；本批不churn）。

### 步骤 3：验收（云端为准）
- `pnpm -r run build` → 0 tsc
- 新测试 + l1 现有测试全绿
- 云端 CI（ubuntu + macOS ID 门 + allFailed + test-lock + Cursor）全绿

### 步骤 4：PR
分支 `fix-remediation` → PR → 云端全绿 → 合并

## 不在本次范围
- ISS-26 GitHub 分支保护（需用户网页操作）
- breaker 改名/合并（分层合理，文档化即可）
