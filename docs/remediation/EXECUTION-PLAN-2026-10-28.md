# 执行规划：从「工程底座可用」到「自进化闭环成立」

> 依据：`EVAL-2026-10-28.md`（24 任务 / 128 发现）。本文件只写**执行顺序与本次会话的落地范围**，
> 细节与证据见评测原文。

## 核心判断（接受，不辩解）

当前三条闭环都**测不出也接受不了真实改进**：
- 分数写死（0.6/0.4/0.5；测试用 mode 开关；脚本复制 baseline）
- canary 与本仓库单测/字面量检查挂钩，没有任何代码拿候选配置真跑 agent
- 轨迹解析器对不上真实格式 → 真实会话挖到 0 条失败
- CLI 起不来（bin 是 .ts，import ./index.js 不存在）
- 部署/回滚有破坏性（吞未提交改动、跨进程回滚失效、变异 LLM 带工具无沙箱）

## 依赖顺序（不可乱）

```
T01 ─┐
T02 ─┼─→ T03 ─→ T04 ─┬─→ T07 ─┬─→ T08 ─┐
T05 ─┘               │        └─→ T13 ─┤
T06(用户)             ├─→ T09 ──────────┤
                      ├─→ T10         ├─→ M1 闭环成立
                      ├─→ T12         │
                      └─→ T17         │
T11 ──────────────────────────────→ T15/T16 ─→ M2 用户能用
T14 ─────────────────────────────────┘
```

关键路径：**T03 → T04 → T07**。

## 本次会话落地范围（按优先级）

### 已完成（上一批，云端已验证）
- 回归门 `allFailed`（任何失败测试→红）——已经抓出并被掩盖的真红
- `evolution.yml` secrets 上下文修复（job 级 if 不允许 secrets）→ main 上 workflow 不再 invalid
- CLN-T03 非 root 断言申诉修订（test-lock 流程）
- ISS-17 六处 strict-improvement 门语义统一

### 本批执行（P0，独立、可并行）
1. **T01**（P0/S）：变异 LLM 去工具 + 隔离 cwd + env 白名单 + stderr 记录
   - 验收：假 pi 记录 argv/cwd/env → 断言 `--no-tools`/`--no-session`、cwd 非仓库根、env 无假密钥；非零退出报告含 stderr 尾
2. **T05**（P0/S）：CI 门盲区收尾
   - T09 publish dry-run 打印 stderr 并从 known-flaky 移除（真修而非豁免）
   - coverage job 去掉 `|| true`，产出真实报告
   - evolution.yml 审计模式用同一个门

### 后续批次（依赖链，需按序）
- **T02**（git 安全 + `evolve rollback`）→ **T03**（隔离副本打分）→ **T04**（合并闭环、删死分数）
- **T07** RolloutRunner（决定性缺口）→ **T08** 任务集 → **T09** 统计接受门
- T11 真实解析器 / T12 优化器接线 / T13 预算
- P2：T14 CLI 可启动 → T15 Claude Code 一等宿主 → T16 pi 注入点 → T18 部署治理
- P3：T20 沙箱接入闭环 / T21 static-core 真实清单 / T22 可达性 / T23 文档如实化 / T24 仓库卫生

### 需要仓库所有者操作
- T06 分支保护 ruleset、T19 secret 配置、T24 Dependabot/secret scanning 开关

## 立即要改的既有问题（PR #18 复盘）

1. `abb48ba` 缺少 `test-lock:` 前缀 → **已改写为 `5ebf966 test(lock): ...`，main 上已无 abb48ba**。
2. `tests/E2E/ISS28-e2e-loop-fake-pi.spec.ts` 断言 `reason: "improved"`，但该 improved 来自
   `ModeEvaluator` 写死的 0.6 > 0.5。**不应作为验收标准锁定**。
   → 本批将其断言改为「只验证流程跑通 + 机械证据真实」，并显式注明分数来源为占位；
   真分数断言留到 T04 完成后由新测试承担。

## 验收纪律（评测给的规则，全部遵守）
1. 一律以 GitHub Actions 结果为准，不认本地跑的结果。
2. 新测试走 test-author 锁定流程并加入 `tests/.baseline/passed.json`。
3. 不把基于写死分数 / FakeLLM 的「改进」断言锁成验收标准。
4. README 的 ✅ 必须有对应 CI 测试证明。
5. T06/T19 的 secret 与分支保护需仓库所有者网页操作。
