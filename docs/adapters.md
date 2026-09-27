# Harness Adapters — 接入矩阵

> Spec: `execution/plugin/TASKS.md` §PLG-T10（PLUGIN 波次收官文档）。
> 素材来源：`packages/evolve-cli/src/registry.ts`（SUPPORTED_HARNESS 真实支持列表）+
> 各 `packages/evolve-*/README.md` + `adapters/src/`（ADP-T02/T03）。
> 铁律：只写已实现的能力；调研未核实的一律标 `verified:false`。

本仓库的 harness 接入分两层：

1. **适配器已建成**（`@harness/adapters` 包内，ADP-T02/T03 实现）：pi、Claude Code。
2. **evolve-* 插件包**（PLG-T02–T07、T11/T12 实现，`evolve` CLI 注册或程序化接入）：
   Codex / OpenCode / Hermes / OpenClaw / Cursor / dsh / Grok Build / generic。

`evolve init` 的 `--harness <id>` 直接受 `SUPPORTED_HARNESS` 校验（当前为
`codex | opencode | hermes | openclaw | cursor | generic`）。dsh / grok 是独立
npm 插件包（程序化接入），CLI 未直注册——其 generic 声明式降级路径见 §3。

## 1. 接入矩阵

| harness | 包名 | 基质 | 轨迹格式 | 轨迹可得性 | 热加载 | 离线模式 | LLM port | 安装命令 |
|---|---|---|---|---|---|---|---|---|
| pi | `@harness/adapters`（PiAdapter）【适配器已建成】 | `pi/` 前缀基质 id，git 版本化目录 | TL-T01 transcript 契约 | yes（TL-T01） | none（打印 restart 提示） | no | PiHeadlessLLM 内建（REAL-T01 同实现） | workspace 引用 `@harness/adapters`（无独立 evolve-pi 包，见 ADP-T02） |
| claude-code | `@harness/adapters`（ClaudeCodeAdapter）【适配器已建成】 | CLAUDE.md + `.claude/skills/<n>/SKILL.md` + hooks policy（git 版本化） | `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` | yes | —（ADP-T03 未定义专门语义） | no | 透传外部注入 LLMPort | workspace 引用 `@harness/adapters`（无独立 evolve-claude-code 包，见 ADP-T03） |
| codex | `@harness/evolve-codex` | `codex/AGENTS.md` + prompts/ | rollout JSONL | yes | none（deploy 打印 restart 提示） | no | 透传外部注入 | `pnpm add @harness/evolve-codex` + `evolve init --harness codex` |
| opencode | `@harness/evolve-opencode` | `.opencode/`（AGENTS.md + opencode.json 片段 + plugins/*.ts），默认基质 id `opencode/AGENTS.md` | storage/session | yes | none（deploy 打印 restart 提示） | no | 透传外部注入 | `pnpm add @harness/evolve-opencode` + `evolve init --harness opencode` |
| hermes | `@harness/evolve-hermes` | `~/.hermes/skills`（默认基质 id `hermes/skills/evolve/SKILL.md`） | state.db（sqlite） | yes | semi（cron 触发 evolve 运行） | no | 透传外部注入 | `pnpm add @harness/evolve-hermes` + `evolve init --harness hermes` |
| openclaw | `@harness/evolve-openclaw` | `~/.openclaw` workspace（默认基质 id `openclaw/skills/evolve/SKILL.md`） | per-agent sqlite | yes | hybrid（deploy 仅提示，不自动 `openclaw gateway restart`） | no | 透传外部注入 | `pnpm add @harness/evolve-openclaw` + `evolve init --harness openclaw` |
| cursor | `@harness/evolve-cursor` | `.cursor/rules/evolve.mdc`（默认基质 id `cursor/rules/evolve.mdc`） | — | **no** | auto（规则下次 agent chat session 自动生效，无需重启） | **yes**（canary-score-driven 离线进化，`buildOfflineConfig` 强制 `offline:true`） | 透传外部注入 | `pnpm add @harness/evolve-cursor` + `evolve init --harness cursor` |
| dsh（DeepSeek Harness） | `@harness/evolve-dsh` | `dsh/AGENTS.md`（repo 级，git 版本化）+ `dsh/profiles/<n>/cordis.patch.yml`（profile 叠加层，整体文本读写，不解析 patch 语义） | `~/.dsh/` 事件溯源 append-only JSONL | yes（Phase2 已核实） | none（deploy 打印 restart 提示） | no | 透传外部注入 | `pnpm add @harness/evolve-dsh`（程序化 `createDshPlugin`；CLI 未注册 `dsh` id） |
| grok（Grok Build） | `@harness/evolve-grok` | `grok/claude/*` 委托 ClaudeCodeAdapter（CLAUDE.md / AGENTS.md / `.claude/rules/`）+ `grok/plugins/*` 原生（`.grok/plugins/evolve/`：`skills/<n>/SKILL.md`、`hooks/hooks.json`、`.mcp.json`） | grok 会话日志 JSONL（字段名容错解析） | **未核实 → offline 降级**（`sessionLogPath` 未注入则 `readTrajectories` 恒 `[]`） | 委托 ClaudeCodeAdapter | yes（轨迹降级时走离线模式，同 Cursor 模式） | 透传外部注入 | `pnpm add @harness/evolve-grok`（程序化 `createGrokPlugin`；CLI 未注册 `grok` id） |
| generic | `@harness/evolve-generic` | 声明式 adapter yaml pathMap 驱动（无静态默认基质 id） | 声明式（yaml 声明 `jsonl` / `json` / `sqlite` / `none`） | declarative | n/a | yes（trajectory `format: none` 时即离线） | 透传外部注入（yaml `llm.passThrough`） | `evolve init --harness generic --adapter-yaml <path>`（`--adapter-yaml` 必填） |

**能力矩阵口径**（对齐 PLG-T10 spec + Phase1/2 调研结论）：

- **轨迹可得性** = yes（Codex / OpenCode / Hermes / OpenClaw / dsh）/ TL-T01（pi / Claude Code）/
  declarative（generic）/ **no**（Cursor——无轨迹，铁律直接离线模式）/
  **未核实降级**（Grok Build——会话日志路径未核实，恒走 offline）。
- **热加载** = none（Codex / OpenCode / dsh / pi）/ semi（Hermes）/ hybrid（OpenClaw）/
  auto（Cursor）/ n/a（generic）。
- **离线模式** = Cursor（canary-score 驱动）/ generic（`format: none`）/ grok（轨迹未核实降级时）。

## 2. 各家详解与已知限制

### pi 【适配器已建成 · ADP-T02】

- 基质 id 形如 `pi/prompts/x.md`（`pi/` 前缀标识宿主，`mapSubstratePath` 映射相对路径）。
- 轨迹：复用 TL-T01 transcript 契约（`readTlTrajectories` + `extractDiagnosis`）。
- LLM：`PiHeadlessLLM` 内建（REAL-T01 RealLLMPort 同实现），不依赖外部透传。
- 已知限制：deploy 后需重启 pi 加载新基质（打印 `[pi] restart pi to load new substrate`）。

### Claude Code 【适配器已建成 · ADP-T03】

- 基质 = CLAUDE.md + `.claude/skills/<name>/SKILL.md` + hooks policy，git 版本化目录。
- 轨迹 = `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`。
- exam-lock：hooks.json PreToolUse 考卷锁定（`tests/**/*.spec.ts` 锁定范围，TEST-LOCK §1 出题权分离）。
- 已知限制：热加载语义未在适配器内专门定义（基质 git 版本化，由宿主自然重读）。

### Codex（PLG-T02）/ OpenCode（PLG-T03）

- 基质 git 版本化（repoRoot staging → git commit/checkout 部署回滚）。
- 已知限制：热加载 none——deploy 后打印 restart 提示（`[codex] restart codex / open new session...` /
  `[opencode] restart opencode...`），不自动 kill 宿主。

### Hermes（PLG-T04）

- 基质 = `~/.hermes/skills`；轨迹 = state.db（sqlite）。
- 热加载 semi：evolve 运行由 cron 触发，非宿主进程内嵌。

### OpenClaw（PLG-T05）

- 基质 = `~/.openclaw` workspace；轨迹 = per-agent sqlite。
- 热加载 hybrid：deploy 仅提示，不代跑 `openclaw gateway restart`（那是 `reload=off` 才需要的操作）。

### Cursor（PLG-T06）

- **无轨迹来源**——不臆测 Cursor 内部会话日志路径，铁律直接离线模式：
  `buildOfflineConfig` 强制 `offline:true`，进化由 canary score 驱动（不读轨迹）。
- 热加载 auto：`.cursor/rules/*.mdc` 规则在下次 agent chat session 自动被发现，无需重启。

### dsh / DeepSeek Harness（PLG-T11，Phase2 调研已核实）

- 基质两类：`dsh/AGENTS.md`（repo 级主基质，git 版本化）与
  `dsh/profiles/<n>/cordis.patch.yml`（profile 叠加层——Cordis 私有 YAML patch 格式，
  **只做整体文本读写，不解析/校验 patch 语义**）。
- 轨迹 = `~/.dsh/` 下事件溯源 append-only JSONL（递归 `*.jsonl`，按 sessionId 分组；
  诊断提取先 `extractDiagnosis`（TL-T01 同构）后私有 error 字段兜底；非法行容错跳过）。
- 已知限制：热加载未核实——deploy 后保守打印 restart 提示；CLI 未注册 `dsh` id，
  以 dsh-plugin npm 包形态程序化接入（`createDshPlugin`）。

### Grok Build（PLG-T12）

- 基质双路由：`grok/claude/*` **直接委托** ClaudeCodeAdapter（不重写，ADP-T03 已锁定）；
  `grok/plugins/*` 原生渲染 `.grok/plugins/evolve/` 目录（hooks.json 复用 ADP-T03 exam-lock 语义）。
- **轨迹未核实 → offline 降级**：grok 会话日志路径/格式调研未逐字核实，
  `sessionLogPath` 未注入则 `readTrajectories` 恒 `[]`（同 Cursor 铁律）。
  注入后解析器容错多 error 字段名（`is_error`/`error`/`failed`/`status==='error'`）。

### generic（PLG-T07）

- 声明式 adapter yaml：pathMap（基质 id → 磁盘路径）+ trajectory format 声明
  （`jsonl` / `json` / `sqlite` / `none`）+ `restartHint` + `llm.passThrough`。
- `evolve init --harness generic --adapter-yaml <path>`（缺 `--adapter-yaml` 直接报错）。
- 已知限制：不校验目标 harness 真实机制——未核实的接入**必须**标 `verified:false`（见 §3）。

## 3. generic 降级示例（verified:false 占位）

`packages/evolve-generic/examples/` 内含两个未核实占位示例（Phase1 调研未覆盖，
任何字段名/路径均为占位，不代表真实机制，接入前须人工核实）：

| harness | 示例 yaml | 声明假设 | 安装命令 |
|---|---|---|---|
| dsh（降级占位） | `dsh.adapter.yaml` | 基质=AGENTS.md；轨迹=sqlite state.db sessions 表 | `evolve init --harness generic --adapter-yaml packages/evolve-generic/examples/dsh.adapter.yaml` |
| grokbuild（降级占位） | `grokbuild.adapter.yaml` | 基质=AGENTS.md；轨迹=rollout JSONL | `evolve init --harness generic --adapter-yaml packages/evolve-generic/examples/grokbuild.adapter.yaml` |

> 两个示例均标 `verified:false — Phase1 调研未覆盖，纯路径映射兜底，接入前须人工核实`。
> 注意：dsh / Grok Build 已有 Phase2 核实后的原生插件包（§2），上述 yaml 仅为
> generic 声明式能力的示例，**不再是这两家的推荐接入方式**。

## 4. agentskills.io skill bundle 安装变体（PLG-T09）

`packages/evolve-dist/scripts/build-skill-bundles.mjs` 生成面向宿主 agent 的
instruction skill bundle（教宿主如何驱动 `evolve` CLI，**不是** HarnessPort 实现）：

- **Claude Code**：`skill-bundles/claude-code/evolve/SKILL.md` → 拷贝到
  `.claude/skills/evolve/SKILL.md`。
- **Hermes**：`skill-bundles/hermes/evolve/SKILL.md` → 拷贝到
  `~/.hermes/skills/evolve/SKILL.md`。

## 5. CLI 命令参考（PLG-T08）

```bash
evolve init --harness <id> [--adapter-yaml <p>] [--substrate-id <id>] [--canary-glob <g>]
#   scaffold .harness/evolve.yaml（已存在则拒绝静默覆盖）
#   --harness 受 SUPPORTED_HARNESS 校验：codex | opencode | hermes | openclaw | cursor | generic
evolve run [--config <path>] [--generations <n>] [--llm <url>]
#   跑进化循环，写 .harness/evolve-state.json
evolve status
#   展示上次进化运行状态
```

LLM 配置：`--llm <url>` 等价覆盖 `EVOLVE_LLM_BASE_URL`；密钥/模型走
`EVOLVE_LLM_API_KEY` / `EVOLVE_LLM_MODEL` 环境变量。pi 适配器内建 PiHeadlessLLM，
其余各家均透传外部注入的 LLMPort。
