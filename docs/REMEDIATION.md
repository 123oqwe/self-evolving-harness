# Issue List · 评审问题清单（待审批）

> 来源：2026-09 对本仓库的架构 / 设计 / 代码 / 测试评审。全部证据均已在仓库当前 `main`
> （`3ad2f12`）上核实。本文件只列问题与修复方案，**不含任何已做出的取舍**；
> 带「选项」的条目需审批时决定。
>
> 级别：**P0** = 闭环结论不可信 / 安全机制失效；**P1** = 架构或门禁缺陷；**P2** = 质量 / 卫生。
> 统计：共 32 条 —— P0 × 6、P1 × 18、P2 × 8。

## 索引

| ID | 级别 | 类别 | 标题 |
|---|---|---|---|
| ISS-01 | P0 | 设计 | "严格改进门"实为"不退化即放行"，Δ=0 被 accept |
| ISS-02 | P0 | 设计 | 适应度与被进化基质无因果关系 |
| ISS-03 | P0 | 设计 | "首次真实进化"结论为假阳性 |
| ISS-04 | P0 | 设计 | 统计检验已实现但未接入闭环 |
| ISS-05 | P0 | 安全 | 打分绕过沙箱，无门拦截 |
| ISS-06 | P1 | 设计 | canary 集对 agent 可见，非真 held-out |
| ISS-07 | P1 | 设计 | mine 与 canary 之间无去污染检查 |
| ISS-08 | P1 | 设计 | 失败轨迹为手工构造，挖掘步从未跑过真实数据 |
| ISS-09 | P0 | 安全 | 考卷锁定 hook 不符合 Claude Code schema，不生效 |
| ISS-10 | P1 | 安全 | Bash 路径模式拦截可被绕过 |
| ISS-11 | P1 | 安全 | eperm 伪造判定仅依赖 exitCode 单信号 |
| ISS-12 | P2 | 安全 | 报告泄露本机绝对路径 |
| ISS-13 | P1 | 架构 | l3-engine ↔ canary-eval 循环依赖 |
| ISS-14 | P1 | 架构 | 跨包依赖未在 package.json 声明 |
| ISS-15 | P1 | 架构 | 无构建产物，脚本深入 `src/` 导入 |
| ISS-16 | P1 | 架构 | 多个优化器为死代码 |
| ISS-17 | P1 | 架构 | 同一概念多份重复实现 |
| ISS-18 | P1 | 架构 | "L0 不可变核心"无运行时强制 |
| ISS-19 | P1 | 架构 | Claude Code 适配器完成度被夸大 |
| ISS-20 | P2 | 代码 | L2 embedding 为 8 维 mock 且不可注入 |
| ISS-21 | P2 | 代码 | `@types/node` 版本与 engines 不一致 |
| ISS-22 | P1 | 文档 | README / 注释引用不存在的文档 |
| ISS-23 | P2 | 文档 | 文档内容过期 |
| ISS-24 | P1 | 测试/CI | 回归门只数通过数量，可置换绕过 |
| ISS-25 | P1 | 测试/CI | 回归基线过期（839 vs 869） |
| ISS-26 | P1 | 测试/CI | 测试锁无仓库外信任根 |
| ISS-27 | P1 | 测试/CI | 哨兵测试列表硬编码且覆盖不全 |
| ISS-28 | P1 | 测试/CI | 关键真实路径在 CI 中从不执行 |
| ISS-29 | P2 | 测试/CI | 测试断言源码文本而非行为 |
| ISS-30 | P2 | 测试/CI | 测试在包外，无法按包统计覆盖率 |
| ISS-31 | P2 | 测试/CI | CI 配置自相矛盾 / 重复 / 错字 |
| ISS-32 | P2 | 卫生 | 大体积重复报告文件入库 |

---

## 一、设计：进化闭环

### ISS-01 · P0 · "严格改进门"实为"不退化即放行"
- **证据**：`packages/l3-engine/src/strict-improvement.ts` 的 `decide()` 只在「任一维退化 ≥ τ」时
  reject，从不检查是否存在改进；`tests/L3/T04-strict-improvement.spec.ts` 中
  「τ=0.02、退化 0.01 → accept」把这一语义锁进了测试。
- **影响**：没有任何改进的变体（甚至轻微退化的）可以被部署；闭环可无限"原地进化"。
- **修复方案**：
  1. `decide()` 增加模式：`strict`（默认）= 无维度退化 ≥ τ **且** 至少一维按方向改进
     > `minImprovement`（默认 0，按维可配）；`non-inferiority` = 现有语义，调用方须显式声明。
  2. `Decision` 增加 `reason: "improved" | "regression" | "no-improvement"` 与 `mode`。
  3. 修订 T04：原「τ 内轻微退化 → accept」改为 reject(`no-improvement`)；新增
     「一维改进 + 另一维 τ 内轻微退化 → accept」保留 τ 容差原意；新增「Δ 全 0 → reject」。
     测试改动以 `test-lock:` 前缀单独提交并更新 TEST-LOCK.md 对应 hash。
- **验收**：Δ 全 0 → `accept=false, reason="no-improvement"`；方向（token 翻转）/ τ 边界 /
  缺字段异常用例全绿；`non-inferiority` 模式下行为与旧版逐用例一致。
- **关联**：ISS-17（l1-config 另有 5 份 gate 需同步语义）。

### ISS-02 · P0 · 适应度与被进化基质无因果关系
- **证据**：`reports/evolution-run-001.md` §4.2 自述：canary 任务是 L0C 单测，使用各自 fixture，
  **不读取** `compaction-summary.md`，候选与 baseline 产出相同 `VerifierRun`。
- **影响**：打分对被进化对象恒定，下游选择 / 统计 / 档案全部失去意义。
- **修复方案**：
  1. **部署后打分**：canary 任务在 manifest 中声明 `substrate` 依赖；score 步把候选写入临时
     workspace，以 `HARNESS_SUBSTRATE_PATH` 注入 verify 命令，baseline 同法打分。
  2. **基质敏感任务**：为 compaction prompt 增加确定性结构代理任务（必需段落存在、`Blocked`
     段不可合并、要求保留 tool_use_id 与错误原文、`<safety>` 段完整）。明确标注为 *proxy*，
     不代表摘要语义质量；语义评测（fixture 对话 → LLM 压缩 → 确定性判分：未解决 bug 字符串、
     tool_use_id、错误原文是否保留）列为后续，需 LLM 密钥。
  3. **敏感性守卫**：baseline 与所有候选的逐任务结果向量完全相同 → 判 `insensitive`，
     拒绝 accept 并写入报告。
  4. **阴性对照**：每轮自动构造一个故意破坏的候选（如删掉 `Blocked` 段），其得分必须低于
     baseline，否则判任务集无效并 abort。
  5. 把 `scripts/run-evolution-001.mjs`（599 行）中的闭环逻辑下沉为库函数
     `runEvolutionCycle()`（l3-engine），脚本仅做组装，便于测试。
- **验收**：e2e 测试中：改候选内容会改变 proxy 任务结果；内容无关的任务集触发 `insensitive`；
  阴性对照得分低于 baseline，否则 abort。
- **关联**：ISS-03、ISS-28。

### ISS-03 · P0 · "首次真实进化"结论为假阳性
- **证据**：`reports/evolution-run-001.md` §5 三个候选 Δ 全 0 仍 `accept=true` 并部署；
  `metrics.json` 同时记录 `"lift": 0` 与 `"decision": "accept"`。
- **影响**：对外宣称的里程碑不成立；`metrics.json` / `metrics-trend.md` 在统计一次无效运行。
- **修复方案**：
  1. 在 run-001 报告顶部加「结论无效」声明（原因：ISS-01 + ISS-02），正文保留作审计记录，不改写。
  2. 报告格式与 `scripts/metrics.mjs` 增加 `valid` / `invalidReason` 字段，聚合时排除无效运行。
  3. ISS-01/02/04/05 修复后，以新编号 run-002 重跑（需本地 pi 环境）。
- **验收**：`metrics.json` 中 run-001 标记 `valid:false` 且不计入 summary；metrics 单测覆盖该字段。

### ISS-04 · P0 · 统计检验已实现但未接入闭环
- **证据**：`packages/canary-eval/src/mcnemar.ts`、`power-analysis.ts` 未被
  `scripts/run-evolution-001.mjs` 或任何闭环代码调用；select 步只比较 3 个任务的均值。
- **影响**：3 任务 × 1 次运行、结果为 0/1，统计功效近零，任何"改进"都可能是噪声。
- **修复方案**：
  1. 新增 `selectWithEvidence()`：输入 baseline / candidate **逐任务配对**结果（每任务可重复
     k 次以吸收 LLM 不确定性），输出 `accept | reject | underpowered`，并附 n、b、c、p 值。
  2. 判定：n < `minTasks` → `underpowered`（不部署）；否则 McNemar（不一致对 < 25 时用精确
     二项检验），p < α 且方向为改进才 accept。
  3. `minTasks` 由 `power-analysis` 按目标效应量和 α、β 计算，而非拍脑袋常数。
  4. `StrictImprovementGate`（多维阈值）与 `selectWithEvidence`（显著性）串联：两者都通过才 accept。
- **验收**：单测覆盖 underpowered / 显著改进 / 显著退化 / 不显著 四种路径；输出字段完整。
- **备注**：接入后，在现有小 canary 集上进化将全部判 `underpowered`——这是正确结果，
  暴露的是 canary 集规模不足（见 ISS-06）。

### ISS-05 · P0 · 打分绕过沙箱，无门拦截
- **证据**：`scripts/run-evolution-001.mjs:52` 直接使用 `NoneBackend`；报告表格
  `sandboxBypassed: true`；该字段仅在 `packages/canary-eval/src/verifier.ts:99` 被透传，
  全仓无任何消费方据此拒绝。
- **影响**：「不可信代码只在 hands 沙箱运行」的信任域在真实路径上断开；被进化的内容若含可执行
  部分，将在宿主上无隔离运行。
- **修复方案**：
  1. `assertFreshEvidence` 默认拒绝任何 `sandboxBypassed=true` 的证据；仅当显式传入
     `allowSandboxBypass: true` 时放行，并在结果与报告中打 `unsafeDev: true` 标记。
  2. 闭环脚本改用 `detect()` 选择后端，不再硬编码 `NoneBackend`。
  3. 被绕过沙箱产生的 `epermHits` 一律视为不可信（与 ISS-11 联动）。
- **验收**：bypass 证据默认 throw；opt-in 时通过且带标记；Linux CI（已装 bwrap）上闭环 e2e 以
  真实沙箱运行，`sandboxBypassed=false`。

### ISS-06 · P1 · canary 集对 agent 可见，非真 held-out
- **证据**：`packages/canary-eval/canary/manifest.yaml` 及其引用的测试均在仓库内；
  README「安全模型」第 2 条称 canary「对 agent 不可见、不可训、不可改」。
- **影响**：agent 可读取甚至过拟合评测集；README 声明与事实不符。
- **修复方案**：
  1. 短期：canary manifest 与其引用路径加入 `STATIC_CORE_PATHS`（写入即 throw）和考卷锁定
     范围；manifest 内容 hash 钉死在 L0 常量中，加载时校验。
  2. 中期：划分 `canary/public`（开发自测）与 `canary/hidden`（存放在仓库外，如私有仓库或
     CI secret artifact，仅评测时拉取）。
  3. README 如实改写：当前仅满足「不可改」，未满足「不可见」。
- **验收**：写 canary 路径 throw；manifest 被改 → 加载失败；README 描述与实现一致。

### ISS-07 · P1 · mine 与 canary 之间无去污染检查
- **证据**：闭环中 mine → mutate 之间无任何 taskId / 内容重叠检查。
- **影响**：canary 任务可能进入失败轨迹、再进入变异 prompt，造成评测泄漏。
- **修复方案**：`runEvolutionCycle()` 在 mine 后执行两级检查：①轨迹引用的 taskId ∩ canary
  taskId = ∅；②轨迹文本与 canary 任务描述的 n-gram 重叠率低于阈值。任一不满足即 abort 并报告。
- **验收**：构造含 canary taskId 的轨迹 → abort；含 canary 描述原文片段 → abort。

### ISS-08 · P1 · 失败轨迹为手工构造
- **证据**：`reports/evolution-run-001.md` §2 标注三条轨迹均为「手工构造」。
- **影响**：mine 步（失败聚类、Lucky-Pass 过滤）从未在真实数据上运行。
- **修复方案**：
  1. `Trajectory` 增加必填字段 `source: "real" | "synthetic"`。
  2. 全部为 synthetic 时，闭环只允许 dry-run，不允许 deploy（除非显式 flag，且报告标注）。
  3. 接入真实来源：从 TL-T01 TranscriptWriter 落盘的 JSONL 或 Claude Code 会话日志读取。
- **验收**：纯 synthetic 输入时 deploy 被拒；真实 JSONL fixture 能走通 mine 步。

---

## 二、安全

### ISS-09 · P0 · 考卷锁定 hook 不符合 Claude Code schema，不生效
- **证据**：`adapters/src/claude-code/exam-lock.ts:71-83` 输出
  `{hooks:{PreToolUse:[{matcher:{tool,pathPattern},decision:"deny",reason}]}}`。
  Claude Code 真实格式为 `matcher` 字符串 + `hooks:[{type:"command",command}]`，由外部命令读
  stdin JSON 后返回判定；声明式的 `decision` / `pathPattern` 字段不存在。
- **影响**：「宿主侧拒改测试」在真实 Claude Code 中完全不生效，只在自身单测里自证成立。
- **修复方案**：
  1. 生成真实配置：
     `{"hooks":{"PreToolUse":[{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"node <abs>/exam-lock-hook.mjs"}]}]}}`。
  2. 新增 hook 脚本 `exam-lock-hook.mjs`：从 stdin 读取 `tool_name` / `tool_input`；命中锁定
     路径时输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`。
  3. 提供安装函数，写入目标项目的 `.claude/settings.json`（合并而非覆盖）。
- **验收**：以真实格式的 stdin JSON 驱动脚本：Write/Edit 锁定文件 → deny；非锁定文件 → allow；
  生成的配置通过 schema 校验（字段名、嵌套结构）。

### ISS-10 · P1 · Bash 路径模式拦截可被绕过
- **证据**：exam-lock 对 Bash 仅按路径模式匹配命令文本。
- **影响**：`cp` / `mv` / `git checkout -- tests/...` / 变量拼接路径 / `cd tests && ...` 等均可绕过。
- **修复方案**：
  1. hook 的 Bash 规则采用保守策略：命令文本出现 `tests/` 且含任一写语义（重定向、`sed -i`、
     `tee`、`cp`、`mv`、`rm`、`git checkout`、`git restore`、`patch`、`cd tests`）即 deny。
  2. 文档明确：hook 是**减速带而非安全边界**。
  3. 真正的边界落在两处：①agent 进程运行在 l0-sandbox 的 fs profile 下，`tests/` 为只读挂载
     （复用现有 `fs-isolation` 的 deny-write 规则）；②CI 测试锁 + CODEOWNERS（ISS-26）。
- **验收**：Bash 用例表（≥10 种写法）全部 deny，只读命令（`cat`、`grep`、`vitest run`）allow；
  在 bwrap profile 下对 `tests/` 写入返回 EPERM。

### ISS-11 · P1 · eperm 伪造判定仅依赖 exitCode 单信号
- **证据**：`packages/canary-eval/src/eperm-cross-check.ts` 仅在 `epermHits` 非空且
  `exitCode===0` 时判伪造。
- **影响**：进程输出伪造的 "Operation not permitted" 后以非零码退出，即可让伪造证据被判为一致。
- **修复方案**：
  1. `epermHits` 的来源从「解析用户可控 stderr」改为「沙箱后端自身的拒绝审计」
     （bwrap / seatbelt 的 deny 日志）；stderr 解析结果降级为提示，不作为证据。
  2. 过渡期增加关联校验：EPERM 行中的路径必须命中当前 profile 的 deny 规则，否则判伪造。
  3. `sandboxBypassed=true` 时 `epermHits` 一律丢弃（与 ISS-05 联动）。
- **验收**：伪造 EPERM + 非零退出 → 判伪造；路径不在 deny 规则内 → 判伪造；原 SEC-T01 七个用例保持绿。

### ISS-12 · P2 · 报告泄露本机绝对路径
- **证据**：`reports/evolution-run-001.md` §4.1 表格含 `/Users/<user>/self-evolving-harness/...`。
- **影响**：泄露个人用户名与目录结构。
- **修复方案**：报告写入函数统一脱敏（repo 根 → `<repo>`，HOME → `~`）；清洗现有报告；
  CI 增加一步 grep 检查。
- **验收**：`grep -rE "/Users/|/home/" reports/` 为空；脱敏函数有单测。

---

## 三、架构

### ISS-13 · P1 · l3-engine ↔ canary-eval 循环依赖
- **证据**：`packages/l3-engine/src/adapters/evolve-skill-adapter.ts:60`、`e2e-adapter.ts:34`
  导入 `@harness/canary-eval`；`packages/canary-eval/src/lucky-pass.ts:21` 反向导入
  `@harness/l3-engine` 的 `Trajectory` 类型。
- **影响**：破坏 README 宣称的单向分层；将来任一包独立构建或发布都会卡住。
- **修复方案**：
  1. 新增 `packages/contracts`（纯类型，无运行时依赖）：`Trajectory`、`VerifierRun`、
     `Fitness`、`Substrate` 等跨层契约；l3 与 canary-eval 均改为依赖 contracts。
  2. 新增 `scripts/check-deps.mjs`：扫描 `@harness/*` 导入，构建依赖图并检测环；接入 CI。
  3. 约定依赖方向：`contracts ← l0-core ← l0-sandbox ← telemetry / l1 / l2 ← canary-eval ← l3 ← adapters`，写入脚本作为白名单。
- **验收**：`node scripts/check-deps.mjs` exit 0；单测：人为引入反向依赖 → exit 1。
- **选项**：共享类型也可放进 `l0-core`，但会扩大「不可变核心」的变更面，不推荐。

### ISS-14 · P1 · 跨包依赖未在 package.json 声明
- **证据**：`packages/l3-engine/package.json`、`canary-eval`（仅声明 l0-sandbox，漏了 l3）、
  `l2-memory`（漏了 telemetry）均缺 `@harness/*` 声明；全靠根 `package.json` devDependencies 兜底。
- **影响**：包单独使用即失败；依赖关系无法从清单审计。
- **修复方案**：逐包补齐 `dependencies`；`check-deps.mjs` 增加「导入了但未声明」检测。
- **验收**：删掉根 devDependencies 中的 `@harness/*` 后，`pnpm -r build` 与全量测试仍通过。

### ISS-15 · P1 · 无构建产物，脚本深入 `src/` 导入
- **证据**：各包 `main` / `types` 指向 `./src/index.ts`，`build` 为 `tsc --noEmit`；
  `scripts/run-evolution-001.mjs:37-52` 通过自定义 loader `scripts/lib/ts-resolve.mjs` 导入
  `@harness/xxx/src/...ts`，绕开包的公开入口。
- **影响**：包的公开 API 边界形同虚设；运行脚本依赖私有 loader。
- **修复方案**：
  1. 各包补 `exports` 字段，把脚本需要的符号从 `index.ts` 导出。
  2. 脚本只从包根导入（`@harness/l3-engine`），不再出现 `/src/` 深路径。
  3. 运行时统一用 `tsx`（或 Node 的 `--experimental-strip-types`）替代自定义 loader；
     需要发布时再引入真实 `tsc` 构建到 `dist/`。
- **验收**：`grep -rn "@harness/[a-z0-9-]*/src" scripts/` 为空；闭环脚本可运行。

### ISS-16 · P1 · 多个优化器为死代码
- **证据**：`adas-meta-search`、`full-population-beam-search`、`full-pareto-selector`、
  `island-mapelites`、`weight-channel-gate` 在测试之外无任何引用；`textgrad`、`aflow-mcts`、
  `bayesian-surrogate` 仅被 `optimizer-router` 引用，而 router 本身也未被闭环调用。
- **影响**：维护成本高；README 的架构图（beam-search、MAP-Elites 等）让读者误以为已接入。
- **修复方案（选项，需审批）**：
  - A. **标注并隔离**：文档给出状态矩阵（已接入 / 库可用未接入 / 实验性），移到
    `@harness/l3-engine/experimental` 子路径导出，主入口保留兼容再导出一个版本后移除。
  - B. **接入**：在 `runEvolutionCycle()` 中通过 `optimizer-router` 按基质类型选择优化器，
    使其真正可达（工作量大，且依赖 ISS-02/04 先落地）。
  - C. **删除**：连同锁定测试一起删除，走 `test-lock:` 流程。
- **验收**：状态矩阵与 `grep` 可达性一致；若选 A，主入口不再暴露实验性模块。

### ISS-17 · P1 · 同一概念多份重复实现
- **证据**：三份 `breaker.ts`（`l0-core/src/guard/`、`l3-engine/src/`、
  `l0-sandbox/src/action-classifier/`）；l1-config 中 5 份各自实现的
  `*StrictImprovementGate`（`context-mode-router.ts:134`、`failure-recovery.ts:135`、
  `hook-evolution.ts:307`、`reducer-partition.ts:114`、`steering-policy.ts:117`）。
- **影响**：同一判定规则可能各处不一致（ISS-01 修了一处，其余 5 处依旧是旧语义）。
- **修复方案**：
  1. 在 contracts 或 l3 中抽出通用 `compareFitness(dims, directions, tau, mode)`；l1 的 5 个
     gate 改为薄包装，只负责把各自的 fitness 形状映射到通用维度。
  2. 逐一比对三份 breaker 的语义：语义相同则合并为 l0-core 中一个通用 `CircuitBreaker`；
     不同则改名以区分职责（如 `ActionClassifierBreaker`）。
- **验收**：l1 五个 gate 的现有测试全绿，且 Δ=0 行为与 ISS-01 一致；
  `grep -rn "class .*Breaker"` 结果与文档说明一致。

### ISS-18 · P1 · "L0 不可变核心"无运行时强制
- **证据**：保护仅依赖 pre-commit（`--no-verify` 可跳过）与 CI；`STATIC_CORE_PATHS` 只在
  `writeSubstrate` 这一条 API 路径上检查。
- **影响**：agent 通过任何其他写入途径（Bash、直接写文件）都能修改「不可变核心」。
- **修复方案**：
  1. agent 进程运行在 l0-sandbox fs profile 下，`STATIC_CORE_PATHS` 只读挂载（与 ISS-10 同一机制）。
  2. CI 增加 PR diff 检查：触碰 static-core 路径的 PR 必须经 CODEOWNERS 审批（ISS-26）。
- **验收**：沙箱内写 static-core 路径返回 EPERM；PR 触碰 static-core 时 CI 输出需人工审批提示。

### ISS-19 · P1 · Claude Code 适配器完成度被夸大
- **证据**：README 适配器矩阵对 Claude Code 全列 ✅；但 `llmPort` 只是透传外部注入的实现，
  README 称「无独立 headless CLI 契约」——实际 Claude Code 提供 `claude -p`
  （可配 `--output-format json`）无头模式；考卷锁定又不生效（ISS-09）。
- **影响**：文档夸大完成度；Claude Code 宿主上无法独立跑闭环。
- **修复方案**：
  1. 仿照 `PiHeadlessLLM` 实现 `ClaudeHeadlessLLM`（`claude -p` 子进程，含超时与重试）。
  2. ISS-09 修复前，矩阵中「考卷锁定」一格改为 🚧。
- **验收**：用假 `claude` 可执行文件完成 `ClaudeHeadlessLLM` 往返单测；矩阵与实现一致。

---

## 四、代码

### ISS-20 · P2 · L2 embedding 为 8 维 mock 且不可注入
- **证据**：`packages/l2-memory/src/shared/embedding.ts`：`EMBED_DIM = 8`，按字符码累加分桶；
  注释写「集成阶段替换」，但调用方直接 import 函数，没有注入点。
- **影响**：A-Mem 近邻检索与链接判断在语义上不成立，且换真实模型需要改代码。
- **修复方案**：定义 `EmbeddingPort { embed(text): Promise<number[]>; dim; isMock }`；
  A-Mem / trajectory-store 通过构造参数注入；mock 改名 `hashEmbedding` 并设 `isMock=true`；
  生产模式（配置开关）下检测到 mock 时拒绝启动或告警。
- **验收**：注入自定义 port 的单测；默认行为与现状一致；生产模式 + mock → 报错。

### ISS-21 · P2 · `@types/node` 版本与 engines 不一致
- **证据**：`packages/telemetry/package.json` 为 `^20.0.0`，其余为 `^22.10.0`；根 `engines` 为
  `node >=20`，而 CI 只在 Node 22 上跑。
- **影响**：类型可能允许使用 Node 20 上不存在的 API；声明支持的 Node 20 从未被测试。
- **修复方案（选项）**：A. `engines` 改为 `>=22`，统一 `@types/node ^22`；B. 保留 `>=20`，
  统一 `@types/node ^20`，并在 CI 矩阵中加入 Node 20。
- **验收**：全仓 `@types/node` 版本单一；CI 矩阵覆盖 engines 声明的最低版本。

---

## 五、文档

### ISS-22 · P1 · README / 注释引用不存在的文档
- **证据**：README「相关文档」列出 `PRD.md`、`ARCHITECTURE.txt`、`execution/adapt/TASKS.md`；
  几乎每个源文件头部都有 `Spec: execution/.../TASKS.md §...`；`ERRATA-w01` 被多处引用；
  以上文件均不在仓库中。
- **影响**：设计意图无法追溯，新贡献者无法接手。
- **修复方案**：
  1. 新增 `docs/ARCHITECTURE.md`，按真实实现描述分层、数据流、信任域与各模块接入状态。
  2. 若这些规划文档存在于仓库外：将其纳入 `docs/spec/`；若不打算公开：README 删除链接，
     并说明代码注释中的任务号（如 `L3-T04`）指向仓库外的规划文档。
- **验收**：README 中所有相对链接指向存在的文件（加一条 CI 链接检查）。

### ISS-23 · P2 · 文档内容过期
- **证据**：`TEST-LOCK.md` §1.3 写「153 个 `.spec.ts`」，实际 164；README「仓库布局」写
  `metrics.mjs 待 OPS-T02 落地`，实际已存在；`evolution.yml` 注释写「若 metrics.mjs 已落地则跑」。
- **影响**：文档不可信。
- **修复方案**：修正上述文字；文档中不再手写会变的数量，改由 `test-lock-check.mjs` 输出统计。
- **验收**：文档中不存在与实际不符的计数或状态描述。

---

## 六、测试与 CI

### ISS-24 · P1 · 回归门只数通过数量，可置换绕过
- **证据**：`.github/workflows/ci.yml` full-suite job 用 `grep -oE '[0-9]+ passed'` 取数，
  与 `GREENS.baseline` 比较，允许少 2 个；`evolution.yml` 复制了同一逻辑。
- **影响**：删掉 2 个真实测试、加上 2 个空测试，计数不变即可通过；「允许少 2 个」让任意两个
  用例可以悄悄变红。
- **修复方案**：
  1. 新增 `scripts/lib/test-baseline.mjs`：用 vitest `--reporter=json` 产出逐用例 ID
     （文件 + 完整标题）。
  2. 基线改为用例 ID 集合文件 `tests/.baseline/passed.json`；CI 比较集合：基线中任一用例
     不再通过 → fail；仅 `tests/.baseline/known-flaky.json` 中显式列出的用例可豁免（每条需注明原因）。
  3. 删除 `GREENS.baseline` 与计数容差逻辑。
- **验收**：单测：删一个基线用例 → fail；改名一个用例 → fail；新增用例 → pass 并提示更新基线；
  flaky 白名单生效。

### ISS-25 · P1 · 回归基线过期
- **证据**：`GREENS.baseline` = 839；当前全量实际 869 passed、5 skipped。
- **影响**：30 个用例不受回归保护。
- **修复方案**：随 ISS-24 生成 ID 集合基线；CI 在「通过集合 ⊋ 基线」时输出警告并在 PR 中提示更新，
  防止再次过期。
- **验收**：基线文件与当前通过集合一致。

### ISS-26 · P1 · 测试锁无仓库外信任根
- **证据**：hash 表存放在同一仓库的 `TEST-LOCK.md`；`scripts/lib/test-lock-check.mjs` 只比对
  文件与表，不校验修改者或提交；同时修改测试与表即可通过。
- **影响**：「出题权分离」只是社会约定，技术上不成立。
- **修复方案**：
  1. 新增 `.github/CODEOWNERS`：`tests/**`、`TEST-LOCK.md`、`scripts/lib/**`、`.github/**`
     指定测试作者为 owner。
  2. 在 GitHub 开启分支保护 + "Require review from Code Owners"（仓库设置，需仓库管理员操作，代码无法替代）。
  3. `test-lock-check.mjs --commits <base>..<head>`：触碰 `tests/` 或 `TEST-LOCK.md` 的提交必须以
     `test-lock:` 为前缀；PR CI 启用。作为辅助信号，不作为主防线。
- **验收**：单测：非前缀提交改测试 → exit 1；CODEOWNERS 文件存在且覆盖上述路径。

### ISS-27 · P1 · 哨兵测试列表硬编码且覆盖不全
- **证据**：`ci.yml` sentinel job 手写 30 个测试文件；L1 / L2 / L3 / CE / adapt 均不在列表中。
- **影响**：这些层只受 ISS-24 的弱计数门保护；新测试需要人工加进列表，易遗漏。
- **修复方案**：删除硬编码列表；sentinel 改为在 ubuntu + macOS 上跑全量并使用 ISS-24 的 ID 集合门
  （与 full-suite 合并为一个矩阵 job）。
- **验收**：`ci.yml` 不含测试文件清单；macOS 与 Linux 都执行全量。

### ISS-28 · P1 · 关键真实路径在 CI 中从不执行
- **证据**：`tests/adapt/T02-pi-smoke.spec.ts`、`tests/L3/real-llm.spec.ts`、
  `tests/L0S/T04a.*`（DNS 重绑定 / 代理出口 / 非白名单拒绝）均 `skipIf` 门控；
  `evolution.yml` 的真实进化 job 整段被注释。
- **影响**：端到端闭环、LLM 往返、网络隔离从未被 CI 验证。
- **修复方案**：
  1. 增加假 `pi`（及假 `claude`）可执行文件 fixture，按脚本返回预置 JSON；闭环 e2e 测试用它
     在 CI 上无密钥跑通 mine→mutate→score→select→deploy→verify（与 ISS-02 验收共用）。
  2. 查明 T04a 在 CI 上 skip 的具体条件（如缺 socat 或 loopback 能力），在 Linux job 中补齐
     依赖，使其真实执行。
  3. 真实 LLM job 保持手动触发，但改为「未配置 secret 则 skip」的条件 job，而不是注释掉。
- **验收**：CI 日志中闭环 e2e 与 T04a 显示为 passed 而非 skipped；`evolution.yml` 无整段注释的 job。

### ISS-29 · P2 · 测试断言源码文本而非行为
- **证据**：`tests/CE/SEC-T01-eperm-cross-check.spec.ts:138` 读取源文件断言
  `toContain("filterForgedEperm")`。
- **影响**：只测代码结构；重命名即红，行为坏了却可能仍绿。
- **修复方案**：改为行为断言——经 `assertFreshEvidence` 喂入伪造证据，断言其被丢弃并产生告警。
  以 `test-lock:` 流程修订。
- **验收**：该文件不再 `readFileSync` 源码；新断言在移除接线后变红（可用变异验证）。

### ISS-30 · P2 · 测试在包外，无法按包统计覆盖率
- **证据**：所有测试位于根 `tests/`，各包内无测试；未配置覆盖率。
- **影响**：看不出哪个包、哪个模块测试不足。
- **修复方案**：保留现有目录（锁定范围不变），在 vitest 中启用 v8 coverage，按包配置
  `include` 并分别输出报告；CI 上传覆盖率 artifact。门槛先只报告不拦截。
- **验收**：CI artifact 中有按包的覆盖率报告。

### ISS-31 · P2 · CI 配置自相矛盾 / 重复 / 错字
- **证据**：`ci.yml` 末尾一段注释描述「显式 useradd 的非 root job」，而文件开头说明该 job
  已删除；`evolution.yml` 中「祥低于」应为「略低于」；full-suite 与基线比较逻辑在两个 workflow 中
  各复制一份。
- **影响**：误导维护者；两份逻辑容易改漏一份。
- **修复方案**：删除悬空注释；修正错字；把「全量 + 基线门」抽为可复用 workflow 或
  composite action，两处共用。
- **验收**：YAML 解析通过；基线门逻辑只有一份定义。

### ISS-32 · P2 · 大体积重复报告文件入库
- **证据**：`reports/flaky-locator-001.md`（1809 行）与 `reports/flake-runs/flaky-locator-001.md`
  （1771 行）内容近乎一致。
- **影响**：仓库膨胀，审阅噪声大。
- **修复方案**：保留一份结论性摘要入库，原始日志改为 CI artifact 上传，不再提交。
- **验收**：`reports/` 下无重复文件；原始运行日志不入库。

---

## 依赖关系（修复顺序约束）

```
ISS-13/14 (contracts + 依赖声明) ──┐
ISS-01 (gate 语义) ─────────────────┼──▶ ISS-02/04/05/07/08 (闭环重构 runEvolutionCycle)
ISS-11 (eperm 来源) ────────────────┘            │
                                                ├──▶ ISS-28 (CI e2e) ──▶ ISS-03 (run-002 重跑)
ISS-09 ──▶ ISS-10 ──▶ ISS-18 (共用 fs profile 只读机制)
ISS-24 ──▶ ISS-25, ISS-27, ISS-31
ISS-26 需仓库管理员在 GitHub 设置中配合
ISS-16 / ISS-21 需先审批选项
其余条目互相独立
```
