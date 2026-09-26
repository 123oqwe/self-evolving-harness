# 自进化 Agent Harness 层

> 一个在受控、可回滚、防 reward-hacking 前提下，持续改进自身 prompt / 记忆 / 技能 /
> 工作流配置的 **agent 运行时底座**——把"进化闭环"从绑定单一宿主中抽出来，同一套
> L0–L3 抽象可跑在 pi / Claude Code / 任意通用 harness 上。

本仓库是 PRD §1（执行摘要）与 ARCHITECTURE.txt 的工程落地：四层基质分层
（L0 不可变核心 / L1 离线版本化配置 / L2 在线记忆与技能 / L3 进化引擎）+
适配层（`adapters/`）+ 信任域严格分离（brain / hands / session log）。所有进化变更
走 `mine → mutate → score → select → deploy → verify` 闭环，优先确定性验证器
（shell exit code / FAIL-to-PASS test），所有可写库有 Ratchet 有界容量 +
never-auto-delete 回滚，最坏情况一条 `git checkout` 回滚全部基质。

---

## 目录

- [架构总览（ASCII）](#架构总览ascii)
- [适配器矩阵](#适配器矩阵)
- [5 分钟快速上手（pi 适配器）](#5-分钟快速上手pi-适配器)
- [安全模型](#安全模型)
- [仓库布局](#仓库布局)

---

## 架构总览（ASCII）

```
                         ┌─────────────────────────────────────────┐
   harness 宿主          │  pi  ·  Claude Code  ·  OpenHands(🚧)   │
   (宿主私有格式)        └────────────────────┬────────────────────┘
                                              │ 实现 HarnessPort 契约
                         ┌────────────────────▼────────────────────┐
   适配层                │  ADAPTERS  (@harness/adapters)           │
   harness 无关 port     │  HarnessPort: readSubstrate /            │
                         │    writeSubstrate / readTrajectories /  │
                         │    deploy / rollback / llmPort          │
                         │  PiAdapter · ClaudeCodeAdapter ·        │
                         │    ReferenceAdapter(7 包内建)           │
                         └────────────────────┬────────────────────┘
                                              │ 进化引擎只依赖 port，不碰宿主
   ┌──────────────────────────────────────────▼──────────────────────────────────┐
   │  L3  EVOLUTION ENGINE  ·································  离线元循环        │
   │   ①失败聚类 → ②变异生成 → ③确定性打分 → ④held-out 门 → ⑤多样性档案          │
   │   (JSONL轨迹   (beam-search    (verify: exit    (decontaminated  (island    │
   │    + Clio式)    + reflective     code 裁决)      canary ≥3任务)   MAP-Elites)│
   │                  mutation)          ▲                              │        │
   │        ┌────────────────────────────┘                              │        │
   │        └── strict-improvement 硬门 → ⑥Canary 发布(shadow) → ⑦git 回滚 ──┘   │
   └──────────────────────────────────────────┬──────────────────────────────────┘
   ┌──────────────────────────────────────────▼──────────────────────────────────┐
   │  L2  ONLINE MEMORY & SKILLS  · agent 运行时可写, 受门控                       │
   │  Working Mem · Episodic 库 · Skill Library(Ratchet C=50) · Auto-Memory       │
   └──────────────────────────────────────────┬──────────────────────────────────┘
   ┌──────────────────────────────────────────▼──────────────────────────────────┐
   │  L1  VERSIONED CONFIG  · 离线进化, 改写需 reload + canary                     │
   │  prompts/*.md · hooks/policy.yaml · config/*-policy.yaml · tools/registry    │
   │  → git-versioned, sha 钉死; 安全段删改自动 reject                            │
   └──────────────────────────────────────────┬──────────────────────────────────┘
   ┌──────────────────────────────────────────▼──────────────────────────────────┐
   │  L0  IMMUTABLE CORE  · static-core, agent 绝对无写权, 被进化物不可达          │
   │  Agent Loop · 上下文契约 · OS sandbox · memory tool 协议 · 确定性验证器本体   │
   │  守卫: pre-commit 静态检查 + 不变量测试 + breaker clause (异常熔断回 static)  │
   └─────────────────────────────────────────────────────────────────────────────┘

   信任域 Trust Domains
     BRAIN(harness+LLM, 永不持真实凭据, 进化只发生于此)
        ──execute()──▶ HANDS(sandbox, untrusted 模型生成代码, 凭据经 session proxy)
     SESSION LOG(append-only 独立日志, crash 后 wake(sessionId) 重水化)
```

> 架构图素材取自 `ARCHITECTURE.txt`；适配层（`adapters/`）位于 L3 之下、harness 宿主
> 之上，把宿主耦合（基质路径 / 轨迹格式 / LLM 调用 / 部署机制）抽成显式 `HarnessPort`。

---

## 适配器矩阵

`HarnessPort` 契约（`adapters/src/port.ts`）是适配层的钉子：任一 harness 宿主实现
6 个方法（`readSubstrate` / `writeSubstrate` / `readTrajectories` / `deploy` /
`rollback`）+ 1 个 `llmPort` 字段，即可被 L3 进化引擎消费。下表逐方法标注实现状态
与位置。

| HarnessPort 成员 | 通用契约 (HarnessPort) | pi 适配器 | Claude Code 适配器 | OpenHands / 通用 |
|---|:-:|:-:|:-:|:-:|
| 契约定义 | ✅ `adapters/src/port.ts` | — | — | — |
| `readSubstrate` | ✅ ReferenceAdapter | ✅ `adapters/src/pi/substrate.ts` | ✅ `adapters/src/claude-code/substrate.ts` | 🚧 未实现 |
| `writeSubstrate`（落 staging，不覆盖 active） | ✅ ReferenceAdapter | ✅ `adapters/src/pi/substrate.ts` | ✅ `adapters/src/claude-code/substrate.ts` | 🚧 未实现 |
| `readTrajectories`（已过 Lucky-Pass 过滤） | ✅ ReferenceAdapter | ✅ `adapters/src/pi/trajectory.ts` | ✅ `adapters/src/claude-code/trajectory.ts` | 🚧 未实现 |
| `deploy`（版本后缀 + git commit） | ✅ ReferenceAdapter | ✅ `adapters/src/pi/pi-adapter.ts` | ✅ `adapters/src/claude-code/claude-code-adapter.ts` | 🚧 未实现 |
| `rollback`（git checkout） | ✅ ReferenceAdapter | ✅ `adapters/src/pi/pi-adapter.ts` | ✅ `adapters/src/claude-code/claude-code-adapter.ts` | 🚧 未实现 |
| `llmPort` | ✅ 注入 LLMPort | ✅ `PiHeadlessLLM`（`adapters/src/pi/headless-llm.ts`，`implements LLMPort`；与 `RealLLMPort` 同源 `pi -p` spawn 语义的并列实现） | ✅ 透传外部注入 LLMPort | 🚧 未实现 |
| 考卷锁定（exam-lock） | — | — | ✅ `adapters/src/claude-code/exam-lock.ts` | 🚧 未实现 |

**图例**：✅ 已实现并经单测覆盖 · 🚧 未实现（契约已就绪，待落地）· — 不适用。

- **通用契约 (HarnessPort)**：`adapters/src/port.ts` 定义的接口 + `ReferenceAdapter`
  （用已实现 7 包作内建实现，证明契约在真实 git 语义下完备）。这是所有适配器的共同
  契约，**接口只复用不重造**（复用铁律 §0.2）。
- **pi 适配器**：基质 = `~/.pi/agent/{settings.json,prompts,skills}`；轨迹 = 本工程
  TL-T01 TranscriptWriter 落盘的 TL-T01 形状 JSONL（`~/.pi/projects/<encoded-cwd>/`，
  非 pi 原生 session 格式）；LLM = 子进程 `pi -p` 无头调用。
- **Claude Code 适配器**：基质 = `SKILL.md` + `CLAUDE.md` + hooks policy；轨迹 =
  `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`；考卷锁定 = PreToolUse hook 拒改
  `tests/**/*.spec.ts`；LLM 透传外部注入（无独立 headless CLI 契约）。
- **OpenHands / 通用**：🚧 未实现。HarnessPort 契约已就绪，落地新适配器只需实现 6 方法
  + `llmPort` 字段，无需改动 L3 引擎。

---

## 5 分钟快速上手（pi 适配器）

前置：Node 20+、pnpm 10+、本地已安装 pi CLI（`command -v pi` 可达）。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置 pi 基质目录

pi 适配器默认读 `~/.pi/agent/`（`settings.json` + `prompts/` + `skills/`），轨迹读
`~/.pi/projects/<encoded-cwd>/` 下 TL-T01 形状 JSONL。本仓库自带一份 L1 基质 fixture
可作进化对象：

```bash
# 进化对象 = compaction-summary prompt（L1-T02 baseline）
cat packages/l1-config/prompts/compaction-summary.md
```

### 3. 跑一次 pi headless 往返（smoke）

确认 pi 无头调用链路通（无 pi 环境自动 skip，不红）：

```bash
pnpm vitest run tests/adapt/T02-pi-smoke.spec.ts
```

### 4. 跑一次真实进化循环

`scripts/run-evolution-001.mjs` 组装 `RealLLMPort` + `PiAdapter` + canary 任务集 +
`StrictImprovementGate`，跑 `mine → mutate → score → select → deploy → verify` 全
闭环，每步真实输入输出落 `reports/evolution-run-001.md`（reject 也是合法且诚实的
结果，不伪造 lift）：

```bash
node scripts/run-evolution-001.mjs     # 须本地有 pi 环境
cat reports/evolution-run-001.md
```

> 说明：聚合 metrics 的 `scripts/metrics.mjs`（OPS-T02）已落地——跑完进化循环后
> 执行 `node scripts/metrics.mjs --reports reports/ --out metrics.json` 即可聚合
> `reports/evolution-run-*.md` 的 lift/retained/rejected/tokens/decision，产出
> `metrics.json` + `reports/metrics-trend.md`（CI 上传 `metrics.json` artifact）。

> 验收命令：`bash adapters/scripts/verify.sh ADP-T01 ADP-T02 ADP-T03` 逐适配器断言
> `HarnessPort` 全方法 + 复用铁律齐；`bash adapters/scripts/verify.sh ADP-T04` 校验本
> README 要素（`scripts/verify.sh ADP-T04` 经 `lib/dispatch.sh` 是 no-op 占位，不跑
> 任何 grep，勿用）。

---

## 安全模型

进化闭环默认 paranoid：宁可拒绝有效变体，也绝不放行退化或被投毒的基质。五条主线：

1. **static-core 只读（L0）**：验证器本体 / canary 集内容 / 回滚机制本体属 L0
   immutable core，agent 运行时绝对无写权，被进化物不可达。`STATIC_CORE_PATHS`
   （L3-T01 常量）前缀匹配——`writeSubstrate` 尝试写 static-core 路径直接 throw
   （breaker clause 对齐）。pre-commit 静态检查 + 不变量测试 + 异常熔断回 static
   三层守卫。

2. **考卷锁定（出题权分离，TEST-LOCK §1）**：canary 集对 agent 不可见、不可训、不可改
   （防 train/eval leakage 与 Thompson 投毒）。`tests/**/*.spec.ts` 由 test-author
   锁定（sha256 gate，`scripts/verify.sh` 领单入口强制重算比对），implementer 不得改
   测试断言——只能加 `skipIf` / 环境门控，涉及锁定文件须走申诉通道。Claude Code 适配器
   用 PreToolUse hook（覆盖 Write/Edit/Bash 三类工具）在宿主侧拒改测试文件。

3. **strict-improvement 硬门（L3-T04）**：acceptance 阈值只能调严（C 只能调小或持平），
   不可自降。变体须在 held-out decontaminated canary（≥3 任务）上相对 baseline 严格
   改进才 accept；退化指标超 τ 直接 reject。`assertFreshEvidence`（CE-T07）在判定前
   强制 fresh 证据门——拒绝"应该可以了"的断言。

4. **canary shadow 回滚（L3-T08 / L1-T01）**：所有基质 git-versioned，`deploy` 落
   staging（不直接覆盖 active）+ 版本后缀 + git commit，记录 `rollbackTo`（部署前
   HEAD）。退化信号触发 `git checkout <rollbackTo>` 自动回滚，幂等不变量。最坏情况
   一条 `git checkout` 回滚全部基质。

5. **L0S-R2 epermHits×exitCode 强制交叉验证（SEC-T01）**：用户可控 stderr 可伪造
   "Operation not permitted" 行进 `epermHits`（证据非证明）。`crossCheckEperm` 在
   fresh-evidence 门消费前交叉验证——`epermHits` 非空但 `exitCode===0` 判为
   forged-suspect，丢弃该证据并告警，防伪造 eperm 绕过门。

**信任域**（PRD §11.2）：brain（harness + LLM，永不持真实凭据，进化只发生于此）/
hands（sandbox，untrusted 模型生成代码，凭据经 session proxy 在 allowlist host 注入）/
session log（append-only 独立日志，crash 后 `wake(sessionId)` 重水化）三分离。所有
进化变更带 provenance（来源轨迹 id、生成 prompt hash、写入时间戳、写入者 agent id）。

**单调收紧原则**：基质风险递增 prompt → 记忆 → 技能 → 自身代码 → 权重（永久性↑
风险↑ 人类把关↑）；Oracle 分级 确定性验证器 > 异模型 fresh judge > 去偏 LLM judge；
进化速度 ∝ 1/基质永久性（L2 每会话在线 · L1 离线批处理 + PR · L0 永不进化）。

---

## 仓库布局

```
packages/                # 7 个核心包（harness 无关抽象）
├── l0-core/             # L0 不可变核心：Agent Loop / 上下文契约 / 验证器本体
├── l0-sandbox/          # L0 sandbox 原语（Seatbelt/bwrap，文件系统+网络双隔离）
├── l1-config/           # L1 版本化配置：prompts/*.md + ConfigRepo（git sha 钉死）
├── l2-memory/           # L2 在线记忆与技能（Working/Episodic/Skill/Auto-Memory）
├── l3-engine/           # L3 进化引擎：reflective mutation / StrictImprovementGate / Retain
│   └── src/llm/pi-headless-port.ts   # RealLLMPort（pi -p 无头，REAL-T01）
├── canary-eval/         # canary 加载 + 确定性验证器 + fresh-evidence 门 + eperm 交叉验证
└── telemetry/           # TL-T01 TranscriptWriter（JSONL 轨迹契约）
adapters/                # @harness/adapters：HarnessPort 契约 + pi/Claude Code 适配器
├── src/port.ts          # ADP-T01：HarnessPort 契约 + ReferenceAdapter
├── src/pi/              # ADP-T02：pi 适配器
└── src/claude-code/     # ADP-T03：Claude Code 适配器 + exam-lock
scripts/                 # 编排脚本（run-evolution-001.mjs / verify.sh ...；metrics.mjs 待 OPS-T02 落地）
tests/                   # 锁定测试（TEST-LOCK sha256 gate）
reports/                 # 进化循环报告（evolution-run-*.md / metrics-trend.md）
.github/workflows/       # CI + evolution.yml（审计模式默认，真实模式 runbook）
```

---

## 相关文档

- `PRD.md` §1 执行摘要 · §9 成功指标 · §11 安全与合规要求
- `ARCHITECTURE.txt` 总体架构（L0–L3 + 信任域 + 进化元循环）
- `execution/adapt/TASKS.md` 适配层任务规格（本 README 的数据源）
- `TEST-LOCK.md` 测试锁定规则与 sha256 gate
- `docs/runbooks/evolution-real.md` 真实进化模式 runbook（密钥配置 + 回滚预案）
