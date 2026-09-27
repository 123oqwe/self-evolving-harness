# 修复清单（Remediation Plan）

> 来源：2026-09 架构 / 设计 / 代码 / 测试评审。每项含：问题、证据、改法、验收。
> 严重度：**P0** = 闭环结论不可信 / 安全机制失效；**P1** = 架构或门禁缺陷；**P2** = 质量 / 卫生。
> 执行方式：按「波次」分组，每个工作项由三个上下文隔离的 agent 完成
> （test-author → implementer → verifier），见文末「执行图」。

---

## A. 进化闭环正确性（设计）

### A1 · [P0] `StrictImprovementGate` 实为非劣效检验
- **证据**：`packages/l3-engine/src/strict-improvement.ts` 仅在「任一维退化 ≥ τ」时 reject；
  Δ=0 被 accept。`reports/evolution-run-001.md` §5 三个候选 Δ 全 0 仍 accept，
  `metrics.json` 出现 `lift: 0` + `decision: accept`。
- **改法**：默认 `mode: "strict"`——accept 当且仅当 ①无维度退化 ≥ τ，且 ②至少一维
  按方向改进 > `minImprovement`（默认 >0）。`Decision` 增加 `reason`
  （`improved` / `regression` / `no-improvement`）。保留 `mode: "non-inferiority"` 供
  显式选用（调用方必须写明）。
- **验收**：Δ 全 0 → `accept=false, reason="no-improvement"`；原有方向 / τ / 缺字段
  用例语义保持；`tests/L3/T04-strict-improvement.spec.ts` 更新并全绿。

### A2 · [P0] 统计门未接入：3 任务 × 1 次运行无统计功效
- **证据**：`canary-eval/src/mcnemar.ts`、`power-analysis.ts` 已实现但
  `scripts/run-evolution-001.mjs` 未调用。
- **改法**：新增 `selectWithEvidence()`（canary-eval）：输入 baseline / candidate 的
  **逐任务配对** pass/fail 向量，输出 `accept | reject | underpowered`。规则：
  n < `minTasks`（默认 20，可配）→ `underpowered`（不部署）；否则 McNemar
  （n_discordant < 25 用精确二项）p < α 且方向为改进才 accept。
- **验收**：单测覆盖 underpowered / 显著改进 / 显著退化 / 不显著 四种；
  门的输出带 p 值、n、b、c。

### A3 · [P0] 打分绕过沙箱但无门拒绝
- **证据**：进化脚本用 `NoneBackend`，`sandboxBypassed: true` 仅被透传进报告
  （`canary-eval/src/verifier.ts:99`），无任何门消费。
- **改法**：`assertFreshEvidence` 默认拒绝含 `sandboxBypassed=true` 的证据；
  仅在显式 `allowSandboxBypass: true` 时放行，并在结果上打 `unsafeDev: true`
  标记（报告须显示）。`sandboxBypassed` 的证据中 `epermHits` 一律视为不可信。
- **验收**：bypass 证据默认 throw；opt-in 时通过且带标记；原 SEC-T01 用例保持。

### A4 · [P0] 适应度与被进化基质无因果关系（"首次进化"是空转）
- **证据**：canary 任务是 L0C 单测，不读 `compaction-summary.md`（报告 §4.2 自认）。
- **改法**：
  1. canary 任务可声明 `substrate` 依赖；打分时把候选部署到临时 workspace，
     以 `HARNESS_SUBSTRATE_PATH` 注入 verify 命令。
  2. 为 compaction prompt 增加一组**确定性结构代理任务**（检查必需段落、Blocked 段保留、
     tool_use_id / 错误原文保留指令、`<safety>` 段完整）——明确标注为 proxy，非语义评测。
  3. **敏感性守卫**：baseline 与全部候选的逐任务结果向量完全相同 → 判
     `insensitive`，拒绝 accept 并在报告中声明。
  4. 把 600 行脚本里的闭环逻辑下沉为库函数 `runEvolutionCycle()`（l3-engine），
     脚本只做组装。
- **验收**：e2e 测试（假 `pi` 可执行文件 + 临时 git repo）跑通
  mine→mutate→score→select→deploy→verify；候选内容变化会改变 proxy 任务结果；
  内容无关的 canary 集触发 `insensitive`。

### A5 · [P1] canary 集对 agent 可见，mine / canary 无去污染检查
- **改法**：`runEvolutionCycle` 在 mine 后检查轨迹引用的 taskId ∩ canary taskId = ∅，
  否则 abort；canary manifest 路径纳入 `STATIC_CORE_PATHS`，写入即 throw。
  文档如实说明「repo 内 canary ≠ 真 held-out，真 held-out 需仓库外存放」。
- **验收**：交叉污染用例 abort；写 canary 路径 throw。

## B. 安全

### B1 · [P0] 考卷锁定 hook 在真实 Claude Code 中不生效
- **证据**：`adapters/src/claude-code/exam-lock.ts:71-83` 产出
  `{matcher:{tool,pathPattern},decision:"deny"}`，不是 Claude Code hooks schema。
- **改法**：生成真实配置
  `{"hooks":{"PreToolUse":[{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"node <abs>/exam-lock-hook.mjs"}]}]}}`；
  新增 hook 脚本：读 stdin JSON（`tool_name`, `tool_input`），命中锁定路径时输出
  `hookSpecificOutput.permissionDecision = "deny"`。Bash 采用保守规则（命令文本出现
  `tests/` 且含写操作 / 重定向 / `git checkout` / `mv` / `cp` / `rm` 等即 deny）。
  文档注明：hook 是**减速带不是安全边界**，真正边界是 CI 测试锁 + CODEOWNERS。
- **验收**：用真实 stdin JSON 驱动 hook 脚本：Write/Edit 锁定文件 → deny；
  非锁定文件 → allow；Bash `sed -i tests/x.spec.ts` → deny；`cat` → allow；
  配置 JSON 符合 schema。

### B2 · [P2] 报告泄露本机绝对路径
- **证据**：`reports/evolution-run-001.md` 含 `/Users/<user>/...`。
- **改法**：报告写入前把 repo 根 / HOME 替换为 `<repo>` / `~`；清洗现有报告。
- **验收**：`grep -r "/Users/\|/home/" reports/` 为空。

## C. 架构

### C1 · [P1] 包循环依赖且未声明
- **证据**：`l3-engine → canary-eval`，`canary-eval/src/lucky-pass.ts:21 → l3-engine`；
  各包 `package.json` 均未声明 `@harness/*` 依赖，靠根 devDependencies 兜底；
  `@types/node` 版本不一致（telemetry 为 ^20）。
- **改法**：新增 `packages/contracts`（纯类型：`Trajectory`、`VerifierRun`、`Fitness` 等
  跨层契约），打断循环；每个包如实声明依赖；新增 `scripts/check-deps.mjs`
  （未声明导入 + 环检测）并接入 CI；统一 `@types/node`。
- **验收**：`node scripts/check-deps.mjs` exit 0；人为加一条反向依赖 → exit 1（单测）；
  `pnpm -r build` 与全量测试绿。

### C2 · [P1] 死代码 / 重复实现
- **证据**：`adas-meta-search`、`full-population-beam-search`、`full-pareto-selector`、
  `island-mapelites`、`weight-channel-gate` 无非测试引用；三份 `breaker.ts`；
  l1-config 里 5 份各自实现的 `*StrictImprovementGate`。
- **改法**：本轮**不删除**（均有锁定测试，删除需你决策）：README / ARCHITECTURE 中给出
  「已接入主闭环 / 库可用未接入 / 实验性」状态矩阵；l1 的 5 份 gate 记为后续合并项。
- **验收**：文档状态矩阵与 `grep` 可达性一致。

### C3 · [P1] 文档引用不存在的文件
- **证据**：README 与大量注释引用 `PRD.md`、`ARCHITECTURE.txt`、`execution/**/TASKS.md`。
- **改法**：新增 `docs/ARCHITECTURE.md`（反映真实实现）；README 移除 / 改写失效引用，
  说明代码注释中的任务号指向仓库外的规划文档。
- **验收**：README 中所有相对链接指向存在的文件。

### C4 · [P2] L2 embedding 为 8 维字符 hash mock 且不可注入
- **改法**：定义 `EmbeddingPort` 接口，A-Mem / trajectory-store 通过构造参数注入；
  mock 改名 `hashEmbedding`，导出 `isMockEmbedding` 标识。
- **验收**：注入自定义 port 的单测；默认行为不变。

## D. 测试与 CI

### D1 · [P1] 绿灯"计数"门可被置换绕过且基线过期
- **证据**：CI 用 `grep 'N passed'` 与 `GREENS.baseline`（839，实际 869）比较，容差 2。
- **改法**：`scripts/lib/test-baseline.mjs`：用 vitest JSON reporter 产出逐用例 ID；
  基线文件 `tests/.baseline/passed.json`；CI 比对**集合**——任一基线用例不再通过即 fail
  （仅 `known-flaky` 显式白名单可豁免）；新增通过用例提示更新基线。删除 `GREENS.baseline`。
- **验收**：单测：删除一个基线用例 → fail；新增用例 → pass + 提示；flaky 白名单生效。

### D2 · [P1] 哨兵列表硬编码 30 个文件，L1/L2/L3/CE/adapt 不在内
- **改法**：sentinel job 改为在 ubuntu + macOS 上跑全量并用 D1 的 ID 门。
- **验收**：`ci.yml` 不再含硬编码列表。

### D3 · [P1] 测试锁无外部信任根
- **证据**：hash 表在同仓库 `TEST-LOCK.md`，同时改两者即通过。
- **改法**：新增 `.github/CODEOWNERS` 覆盖 `tests/**`、`TEST-LOCK.md`、`scripts/lib/**`、
  `.github/**`；`test-lock-check.mjs --commits <range>`：触碰 `tests/` 或 `TEST-LOCK.md`
  的提交必须以 `test-lock:` 开头，PR CI 启用。文档写明需要在 GitHub 开启分支保护 +
  Require review from Code Owners（仓库设置，代码无法替代）。修正 "153 个文件" 等过期描述。
- **验收**：单测：伪造一个非 `test-lock:` 前缀却改测试的提交 → exit 1。

### D4 · [P2] 读源码文本的"结构测试"
- **证据**：`tests/CE/SEC-T01-eperm-cross-check.spec.ts:138` 断言源码包含函数名。
- **改法**：改为行为断言（经 `assertFreshEvidence` 喂伪造证据，断言被丢弃）。
- **验收**：该用例不再 `readFileSync` 源码。

### D5 · [P2] CI 配置卫生
- **证据**：`ci.yml` 末尾悬空注释（描述已删除 job）；`evolution.yml` 错字「祥低于」；
  `reports/flaky-locator-001.md` 与 `reports/flake-runs/flaky-locator-001.md` 近乎重复。
- **改法**：清理。
- **验收**：YAML 可解析；无悬空注释。

### D6 · [P1] 真实闭环路径在 CI 上从不执行
- **改法**：由 A4 的假 `pi` e2e 测试覆盖（无需密钥，进全量套件）。
- **验收**：同 A4。

---

## 执行图（graph engineering）

```
Wave 1（并行，文件所有权互斥，各自独立 git worktree）
  EVO-GATE  : A1 A2 A3 D4      → l3-engine/strict-improvement, canary-eval/{fresh-evidence-gate,select}
  SEC-LOCK  : B1                → adapters/src/claude-code/exam-lock*, scripts/hooks/
  ARCH-DEPS : C1                → packages/contracts(新), 各 package.json, 跨包 import, scripts/check-deps.mjs
  CI-GATES  : D1 D2 D3 D5       → .github/**, scripts/lib/test-baseline.mjs, test-lock-check.mjs
  L2-EMBED  : C4                → l2-memory/src/shared/embedding.ts 及调用方
        │  （主会话合并 → 冲突解决 → 全量验证）
Wave 2
  EVO-LOOP  : A4 A5 B2 D6       → l3-engine/src/loop/, canary manifest, scripts/run-evolution*, tests/fixtures/fake-pi
        │
Wave 3
  DOCS      : C2 C3             → docs/ARCHITECTURE.md, README.md
  主会话     : 重算 TEST-LOCK 哈希（test-lock: 提交）、生成测试 ID 基线、最终对抗验收
```

每个工作项内部：
1. **test-author**：只看本项规格 + 验收标准，写 / 改 `tests/` 下测试；不看实现方案。
2. **implementer**：只看本项规格 + test-author 产出的测试路径；**禁止改 `tests/`**；
   直到本项测试 + `pnpm -r build` 通过。
3. **verifier**：全新上下文，只看规格 + 验收标准 + `git diff`；跑验收命令并对抗审查，
   不通过则只把问题清单回传给 implementer（最多 2 轮）。

`TEST-LOCK.md` 哈希表与测试基线由主会话在合并后统一重算，避免各分支冲突。
