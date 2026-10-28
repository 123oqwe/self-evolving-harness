# ISS-28 修复规划（TDD：规划 → 测试 → 代码 → 验收 → CI → PR）

## 问题本质（客观）
项目的核心主张是「自进化闭环能产生可验证的改进」。但当前 CI 从未执行过完整闭环：
- `evolution.yml:151` 真实进化 job **整段被注释**（81 行注释）。
- `T02-pi-smoke` / `L3/real-llm` 用 `skipIf(!canSpawnPi)` → CI 无 `pi` 二进制 → 永远 skip。
- `T04a.*` 网络隔离用例 `skipIf(!canHostLoopback)` → 基线生成时（嵌套沙箱）skip。

→ 结论：CI 只证明了**单元级**正确性，从未证明**「mine→mutate→score→select→deploy→verify 真跑得通」**。

## 隐藏盲点（新发现）
`scripts/lib/test-baseline.mjs` 的 ID 集合门只校验 baseline 内的用例。
「基线生成时 skip、CI 上会跑」的用例（如 T04a）若在 CI 失败 → **门禁看不见**。
→ 需要：把「基线生成时被 skip 的用例」记为 `expected-skip`，CI 上若变 passed 则提示更新基线；
若变 failed 则**必须**报错（不能静默）。

## 修复步骤（严格 TDD）

### 步骤 1：写失败测试（先测试）
1. `tests/E2E/ISS28-e2e-loop-fake-pi.spec.ts`（新）：
   - 用假 `pi` fixture（`tests/fixtures/fake-pi/pi`，可执行 shell → 回固定 JSON）
   - 断言 `runEvolutionCycle()` 真跑通 mine→mutate→score→select→deploy→verify
   - 断言产出**可验证的机械证据**（VerifierRun 有真实 exit-code、strict-improvement 决策、报告文件落盘）
   - 断言依赖注入的 `RealLLMPort` 走的是 fake pi（不是 stub）
2. `tests/ops/ISS28-baseline-blindspot.spec.ts`（新）：
   - 构造「baseline 记 skip、本次 failed」场景 → 断言门禁必须 exit 1
   - 构造「baseline 记 skip、本次 passed」→ 断言门禁提示更新（不 exit 1）

### 步骤 2：实现（后代码）
1. `tests/fixtures/fake-pi/pi` + `fake-claude/claude`：可执行 fixture，读 stdin/参数回 canned JSON（匹配 `RealLLMPort` 期望的形状）。
2. `scripts/lib/test-baseline.mjs`：
   - baseline JSON 升级为 `{ passed: [...], skippedAtBaseline: [...] }`（或并列文件）
   - 校验逻辑：`skippedAtBaseline` 中的用例若本次 `failed` → 回归（exit 1）；若 `passed` → warn 提示更新。
3. `.github/workflows/evolution.yml`：把 `# real-evolution:` 整段取消注释，改为**条件 job**：
   - `if: ${{ secrets.EVOLVE_LLM_KEY != '' }}`（未配置 secret 则 skip，而不是注释）
   - 无 secret 时另有 `e2e-fake-pi` job 用 fixture 跑通闭环（这个**无条件**跑，证明闭环可用）。

### 步骤 3：验收
- `pnpm -r run build` → 0 tsc error
- 新测试本地绿
- 哨兵（T01-scaffold / g1-smoke / invariants-A）绿
- 云端 CI 全绿（macOS + ubuntu 双矩阵 ID 门、test-lock、Cursor 评审）

### 步骤 4：PR
- 分支 `fix-remediation` → PR → 等 CI 全绿 → 合并

## 不在本次范围（诚实声明）
- `optimizer-router` 的 `workflow`/`skill` 路由与 7 个实验性优化器接入：需要先有对应的因果+统计检验（ISS-02 的推广），属 V2，保持 `experimental.ts` 隔离 + README 披露。
- ISS-17 重复实现合并：单独一次重构（beam-search vs full-population-beam-search、pareto-selector vs full-pareto-selector），不与 ISS-28 混合以免混淆回归归因。
- ISS-26 GitHub 分支保护：网页端操作，需用户执行。
