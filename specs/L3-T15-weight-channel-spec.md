# L3-T15 — 权重通道设计 spec（默认关闭：KL anchor + 外部 oracle + SFT consolidation[DPPO] + 人工 gate 四阈值）

> Status: **默认关闭 (default off)** — PRD §6.1 N1 硬约束 + R6 风险对应。
> 本 spec 仅定义设计；**不实现权重训练**。权重训练实现留待 spec 评审通过后另立项。

## 0. 目标与范围

权重通道（RLVR / Self-Rewarding / RLEF，改模型权重而非文本）的设计 spec。PRD §6.1/§4.7 明确默认关闭，留作独立 spec。

- **本任务交付**：本 spec 文档 + `WeightChannelGate` 不变量测试钩子（纯断言，无训练实现）。
- **不在范围**：任何权重训练代码（RLVR/DPPO/WebRL 训练循环、checkpoint 落盘、GPU 调度）。权重训练实现留待 spec 评审通过后另立项。

## 1. 默认 off 不变量（PRD §6.1 N1）

```typescript
export const WEIGHT_CHANNEL_DEFAULT = 'off' as const;
```

- `routeOptimizer('weight')` 返回 `null`（L3-T01 已落地，本任务不改动路由表）。
- `WEIGHT_CHANNEL_DEFAULT` 是 frozen const，**无任何 setter**（`setEnabled`/`set`/`enable` 均不暴露）。运行时任何 off→on 翻转必须经 `WeightChannelGate.attemptOpen` breaker 路径（继承 L3-T01 路由表 freeze + L3-T08 rollbackThreshold freeze）。
- 路由表本身在模块加载时 `Object.freeze`，optimizer 不可改 static-core（L3 §0 不变量 3）。

## 2. 四阈值（具体数值 + 判定流程）

任何 off→on 翻转**必须同时满足**以下四阈值。任一不满足 → 通道保持 off + abort + 不 consolidate。

| # | 阈值常量 | 钉死数值 | 含义 | 不满足后果 |
|---|---|---|---|---|
| 1 | `KL_MAX` | **0.05** | 训练前后 policy 与 anchor 的 KL 散度上限（WebRL KL anchor） | KL > KL_MAX → abort + 不 consolidate |
| 2 | `ORACLE_PASS_MIN` | **0.9** | 独立外部 oracle（非 self-judge，非进化基质自身）held-out 通过率下限 | oracle 不可用 或 通过率 < 阈值 → 通道保持 off |
| 3 | `CONSOLIDATION_NONINFERIOR` | **true** | RL policy 须经 SFT consolidation（DPPO 风格蒸馏回可部署权重）+ replay confidence filtering；consolidation 后 held-out 非劣于 RL policy | 非 non-inferior → 不部署 |
| 4 | `HUMAN_GATE_SIGNED` | **true** | 四阈值全满足后仍须人工签字方可开 off→on | 未签字 → breaker reject + securityEvent |

### 2.1 判定流程（gate 算法）

```
checkOpen(pre):
  reasons = []
  if pre.klDivergence            >  KL_MAX            (0.05): reasons += "KL anchor violated ..."
  if pre.oraclePassRate          <  ORACLE_PASS_MIN   (0.9 ): reasons += "external oracle ..."
  if pre.consolidationNonInferior !== true            : reasons += "consolidation ..."
  if pre.humanSigned              !== true            : reasons += "human gate ..."
  return { open: reasons.length == 0, reasons }
```

- `open === true` ⟺ 四阈值全满足。
- `checkOpen` 是**纯函数**，不触碰 sandbox，不翻转通道。
- `reasons` 空 ⟺ `open === true`。

### 2.2 接口签名（spec 钉死，测试钩子）

```typescript
export const WEIGHT_CHANNEL_DEFAULT = 'off' as const;

export interface WeightChannelGate {
  checkOpen(preconditions: {
    klDivergence: number;
    oraclePassRate: number;
    consolidationNonInferior: boolean;
    humanSigned: boolean;
  }): { open: boolean; reasons: string[] };
  // 任何 open=true 须四阈值全满足；否则 breaker reject
}
```

## 3. 运行时 off→on breaker（继承 L3-T01 / T08）

`attemptOpen(pre)` 在 `checkOpen` 之上叠加 breaker：

1. 调 `checkOpen(pre)`。
2. 若 `open === false` → 记录 security event（`sandbox.log.securityEvents.push({ kind: 'weight-channel-breaker', ... })`）并抛 `BreakerError`。通道保持 off。
3. 若 `open === true` → 返回审计结果。**注意**：即便四阈值全满足，本钩子**不翻转** immutable default；真正 enable 是另一项经评审、部署的变更（见 §6 回滚预案）。

- 监控对象：运行时 off→on（复用 T01 路由表 freeze + T08 rollbackThreshold freeze 机制）。
- 错误路径（reward tampering）：运行时 off→on 无人工签 → breaker reject + securityEvent。

### 3.1 静态检查：权重训练库不可达

- optimizer 代码路径**不得 import 权重训练库**（torch / transformers / trl / peft 等）。静态检查：若 static-core 可达权重训练库 → breaker reject（权重训练不在 L3 沙箱内）。
- 本任务不在 L3 沙箱内引入任何权重训练依赖（`package.json` 不新增训练库）。

## 4. SFT consolidation（DPPO）流程

开启后的 consolidation 流程（spec 定义，不实现）：

1. RL 产出 policy（candidate）。
2. replay confidence filtering：按 confidence 过滤 replay buffer。
3. DPPO 风格蒸馏：将 candidate 蒸馏回**可部署权重**（非 candidate 本身直接部署）。
4. held-out 非劣性断言：consolidation 后权重在 held-out 上非劣于 RL candidate policy（`CONSOLIDATION_NONINFERIOR === true`）。
5. 非劣 → 可进入 §2 人工 gate；劣 → 丢弃 candidate，通道保持 off。

## 5. KL anchor（WebRL）

- anchor policy：训练前的冻结 policy（或独立参考 policy）。
- 训练后计算 `klDivergence = KL(post_policy || anchor_policy)`。
- `klDivergence ≤ KL_MAX (0.05)` → 通过；否则 abort + 不 consolidate（防 reward hack / policy collapse）。

## 6. 回滚预案

- off→on 翻转是**经评审、部署的变更**（非运行时自动）。
- 翻转后 breaker 持续监控：任一四阈值在运行时跌出 → 自动回滚到 off（`WEIGHT_CHANNEL_DEFAULT` immutable，回滚 = 不再 authorize enable）。
- 回滚信号：
  - KL 散度持续 > `KL_MAX`。
  - oracle held-out 通过率跌至 < `ORACLE_PASS_MIN`。
  - consolidation held-out 劣化（非 non-inferior）。
  - 人工撤签。
- 回滚动作：撤销 enable 授权（通道回到 default off）；已 consolidate 的权重回滚到 anchor policy（DPPO replay buffer 保留以供审计）。

## 7. 风险登记（PRD R6 对应）

| 风险 | 来源 | 缓解 |
|---|---|---|
| Reward tampering / reward hacking | Skalse reward hackability 论证 | KL anchor + 外部 oracle + 人工 gate + breaker |
| Emergent misalignment | Anthropic emergent misalignment | 默认 off + held-out 非劣性 + 回滚预案 |
| Sycophancy → subterfuge | Denison sycophancy→subterfuge | 独立外部 oracle（非 self-judge）+ SFT consolidation 非劣性 |
| 通道运行时被偷偷打开 | 运行时 off→on 攻击面 | 路由表 freeze + breaker reject + securityEvent + 人工 gate |

## 8. 复用 vs 自研

- **复用（借鉴，不集成）**：teamA RLVR/Self-Rewarding/RLEF/DPPO/WebRL 机制（02-telemetry-eval-engine §4.7）；Skalse reward hackability + Anthropic emergent misalignment + Denison sycophancy→subterfuge 作风险依据（PRD R6）。
- **自研**：本 spec 文档 + `WeightChannelGate` 不变量测试钩子（纯断言，无训练实现）。

## 9. 验收

- **spec 评审**：本文档经架构师 + 安全负责人评审通过（四阈值具体数值 + 判定流程 + 默认 off 不变量 + 人工 gate + 回滚预案 + 风险登记）。
- **默认 off 不变量测试**：`pnpm vitest run tests/L3/T15-weight-channel-off.spec.ts`
  - `WEIGHT_CHANNEL_DEFAULT === 'off'`。
  - 四阈值任一不满足 → `checkOpen` 返回 `open=false` + `reasons` 非空。
  - 四阈值全满足 → `open=true` + `reasons=[]`。
  - 运行时 off→on 无人工签 → `BreakerError` + securityEvent。
  - spec 文档存在且钉死四阈值常量名。

## 10. 阈值常量索引（测试 oracle 单一事实源）

本 spec 钉死如下常量名（测试以常量名为 oracle，数值见 §2 表）：

- `KL_MAX` = 0.05
- `ORACLE_PASS_MIN` = 0.9
- `CONSOLIDATION_NONINFERIOR` = true
- `HUMAN_GATE_SIGNED` = true
