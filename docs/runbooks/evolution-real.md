# Runbook: 真实进化模式 (Real Evolution Mode)

> 对应: `.github/workflows/evolution.yml` 的注释关闭 `real-evolution` job.
> Spec: `execution/adapt/TASKS.md` §OPS-T01 / §REAL-T02.

## 1. 何时用真实模式

审计模式 (默认, 无密钥) 只跑全套件 + 基线门 + test-lock 门 + metrics, 不调 LLM, 不烧费用.
真实模式用 `pi -p` 无头子进程 (RealLLMPort, REAL-T01) 真调 LLM, 跑一次完整进化循环
(mine → mutate → score → select → deploy → verify), 产出 `reports/evolution-run-*.md`.

**只在以下条件全满足时启用:**

- 已配置 LLM secret (`PI_API_KEY` 或 `OPENAI_API_KEY`, 见 §3).
- CI runner 上 `pi` 可达 (`command -v pi` exit 0). GitHub-hosted runner 默认无 pi,
  须用 self-hosted runner 或在 step 里安装 pi.
- 明确要烧 LLM token (单次循环 ≥3 canary 任务 × 多变异 × judge, 见 REAL-T02 成本说明).

否则用审计模式即可——审计模式全绿即 harness 健康.

## 2. 触发步骤

1. 在仓库 **Settings → Secrets and variables → Actions** 配置 secret:
   - `PI_API_KEY`: pi 调用 LLM 的 API key (主力).
   - `OPENAI_API_KEY` (可选): 异模型 fresh judge (REAL-T03), 须与 `PI_API_KEY` **不同 provider**
     才算真异模型族 (同 provider 仍同族, CE-T05 `SameModelFamilyError` 会降级 judge).
2. 编辑 `.github/workflows/evolution.yml`, 取消 `real-evolution` job 的行首 `#` 注释.
3. 在 **Actions** 页面选 "Evolution" workflow → "Run workflow".
4. 勾选 `real_evolution` 输入为 `true` → Run.
5. 等待 `real-evolution` job 完成, 下载 `evolution-run-<sha>` artifact 查看报告.

## 3. 密钥配置

| Secret 名 | 用途 | 必需 |
| --- | --- | --- |
| `PI_API_KEY` | pi 无头调用 LLM (mutate / score-judge) | 是 (真实模式主力) |
| `OPENAI_API_KEY` | 异模型 fresh judge (REAL-T03) | 否 (judge 同族时降级回默认 0.5, 见 §5) |

> **铁律**: secret 双条件门 `inputs.real_evolution == true && secrets.PI_API_KEY != ''`
> 缺一即 skip 本 job 且不红——无密钥时 CI 不红是 OPS-T01 安全不变量.

> secret 须最小权限 (restricted scope), 仅 evolution workflow 可见 (关 `All workflows` 共享).
> 别把 key 写进 commit / `.env` (static-core 路径受 L0S 沙箱保护, 但 commit 仍会泄漏).

## 4. reject 是合法结果

`run-evolution-001.mjs` 跑出 **全部变异被 strict-improvement 拦住 (reject_all)** 也是 exit 0.
这是铁律 (REAL-T02 行为规范): reject ≠ CI 失败——strict-improvement 在工作本身就是健康信号,
伪造 lift 才是 R1 reward hacking 的元层投影 (禁止).

仅以下情况让 `real-evolution` job 红:

- LLM 调用超时 / 崩溃 (RealLLMPort `PiHeadlessTimeout` / `PiHeadlessError` 未重试成功).
- 变异输出非法 JSON 且循环编排器未 graceful 跳过 (REAL-T02 边界: 非法 JSON 须丢弃该候选继续).

审计 job 不受影响 (独立 job, 仅 `needs: audit` 顺序约束).

## 5. 回滚预案 (Rollback)

真实模式 accept 一个变异后, `deploy` 步在 repo git 上 commit + 版本后缀 (L3-T08 `bumpVersion`).
若 verify 步发现回归或事后发现退化:

1. **立即回滚**: `git revert <deploy-sha>` 或 `git checkout <rollbackTo-sha> -- <substrate-path>`.
   `DeployResult.rollbackTo` = 部署前 HEAD, 记录在 `reports/evolution-run-*.md` 的 deploy 步.
2. **重跑审计模式**: 手动触发 Evolution workflow (不勾 real_evolution) 验证回滚后全套件全绿
   且 green 数回到 GREENS.baseline 容差内.
3. **事故记录**: 在 `reports/` 新建 `incident-<date>.md` 记录退化现象 + 回滚 sha + 根因.
4. **容差门兜底**: 若回滚后 green 数仍 < baseline-2, ci.yml 的 full-suite 基线门会红,
   阻断后续 PR merge——这是最后一道防线.

> **同族 judge 降级** (REAL-T03): 若 judge model 与 mutate model 同 provider,
> CE-T05 抛 `SameModelFamilyError`, 真实模式须 catch 并标注
> `sameFamilyWarning=true` + `judgeDegraded=true`, judge 降级回默认 0.5.
> 此时 select 决策可信度下降——runbook 须在报告中显式标注, 不伪造异模型分数.

## 6. 成本控制

- schedule 仅跑审计模式 (周一次, 不烧 LLM). 真实模式只走 `workflow_dispatch` 手动触发.
- canary 任务集只取 ≥3 (不是全集) 控制单次成本 (REAL-T02 执行提示).
- judge 用 position-swap 两次评分 (CE-T05), 不重复跑全套件.
- 超时 `timeoutMinutes: 40` 兜底防 LLM 挂死烧钱.

## 7. 不破坏 ci.yml

本 workflow 与 `.github/workflows/ci.yml` 完全解耦: 独立 trigger, 独立 concurrency group,
独立 job. 真实模式 job 红不影响 ci.yml 的 sentinel / full-suite / test-lock 门.
audit job 复用相同的 verify 脚本与基线容差, 但跑在独立 workflow 上, 不阻塞 PR.
