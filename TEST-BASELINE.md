# TEST-BASELINE — RED Gate (wave 0 + 1)

> 生成于 RED 验证阶段。命令：`pnpm vitest run`。exit code = **1**（非 0，符合 RED 预期）。
>
> 全部被测模块尚未实现：`packages/*/src/index.ts` 均为 `export {}` 占位，且 `@harness/*` 工作区包未链接进 `node_modules`，故所有依赖包名导入的 spec 在 suite 加载期即失败 = 合法 RED（`Cannot find module @harness/...`）。

## 1. RED Gate 执行结果（`pnpm vitest run`）

| 指标 | 值 |
| --- | --- |
| 收集到的 spec 文件 | **18**（全部位于 `tests/`，由 `vitest.config.ts` `include: ["tests/**/*.spec.ts"]` 圈定） |
| 失败 suite | **18 / 18** |
| 通过的测试 | **0**（无出题事故） |
| transform / parse error | **0**（所有文件均被成功 transform/collect；失败一律为 module-resolution load error，非语法崩坏） |
| 执行测试用例数 | 0（全部在 suite 加载期失败，未进入 test 体） |
| exit code | 1 |

失败模式分布：

| 失败模式 | 命中文件数 | 合法 RED? |
| --- | --- | --- |
| `Failed to load url @harness/l0-sandbox ... Does the file exist?`（= Cannot find module @harness/l0-sandbox） | 14（L0S 全部） | ✅ 合法 RED |
| `Failed to load url @harness/telemetry ... Does the file exist?`（= Cannot find module @harness/telemetry） | 4（TL 全部） | ✅ 合法 RED |
| transform / parse error | 0 | — |

> 注：`tests/L0S/T02.sandbox-platform-skip.spec.ts` 使用 `vi.mock("@harness/l0-sandbox")`，因同一根因（包不可解析）触发 vitest mock hoist 包装错误，**底层 cause 仍为 `Cannot find module @harness/l0-sandbox`**，属合法 RED，非语法错误。

## 2. 任务 → 测试文件 → 测试数 → 失败模式

### 2.1 Wave 1 — 根级 spec（`tests/`，被 `pnpm vitest run` 收集，全 RED）

#### L0S — OS sandbox / 会话原语（包：`@harness/l0-sandbox`，未实现）

| 任务 | 测试文件 | 测试数 | 失败模式 |
| --- | --- | --- | --- |
| L0S-T01 | `tests/L0S/T01.brain-no-credential.spec.ts` | 5 | Cannot find module @harness/l0-sandbox |
| L0S-T01 | `tests/L0S/T01.session-log-append-only.spec.ts` | 6 | Cannot find module @harness/l0-sandbox |
| L0S-T01 | `tests/L0S/T01.session-wake-idempotent.spec.ts` | 3 | Cannot find module @harness/l0-sandbox |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-egress.spec.ts` | 1 | Cannot find module @harness/l0-sandbox |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-ssh.spec.ts` | 2 | Cannot find module @harness/l0-sandbox |
| L0S-T02 | `tests/L0S/T02.sandbox-platform-skip.spec.ts` | 1 | Cannot find module @harness/l0-sandbox（vi.mock hoist 包装，cause 同根因） |
| L0S-T03 | `tests/L0S/T03.deny-read-ssh.spec.ts` | 4 | Cannot find module @harness/l0-sandbox |
| L0S-T03 | `tests/L0S/T03.narrower-allow-reopens.spec.ts` | 4 | Cannot find module @harness/l0-sandbox |
| L0S-T03 | `tests/L0S/T03.symlink-bypass-blocked.spec.ts` | 3 | Cannot find module @harness/l0-sandbox |
| L0S-T03 | `tests/L0S/T03.worktree-write-scoped.spec.ts` | 2 | Cannot find module @harness/l0-sandbox |
| L0S-T06 | `tests/L0S/T06.concurrency-limit.spec.ts` | 1 | Cannot find module @harness/l0-sandbox |
| L0S-T06 | `tests/L0S/T06.orphan-list.spec.ts` | 1 | Cannot find module @harness/l0-sandbox |
| L0S-T06 | `tests/L0S/T06.teardown-on-throw.spec.ts` | 1 | Cannot find module @harness/l0-sandbox |
| L0S-T06 | `tests/L0S/T06.timeout-kills.spec.ts` | 1 | Cannot find module @harness/l0-sandbox |
| **L0S 小计** | **14 文件** | **35 测试** | 全 RED |

#### TL — Telemetry（包：`@harness/telemetry`，未实现）

| 任务 | 测试文件 | 测试数 | 失败模式 |
| --- | --- | --- | --- |
| TL-T01 | `tests/TL/T01-transcript.spec.ts` | 5 | Cannot find module @harness/telemetry |
| TL-T02 | `tests/TL/T02-usage.spec.ts` | 7 | Cannot find module @harness/telemetry |
| TL-T05 | `tests/TL/T05-schema-policy.spec.ts` | 8 | Cannot find module @harness/telemetry |
| TL-T06 | `tests/TL/T06-budget-policy.spec.ts` | 7 | Cannot find module @harness/telemetry |
| **TL 小计** | **4 文件** | **27 测试** | 全 RED |

**Wave 1 根级 gate 合计：18 文件 / 62 测试 / 0 通过 / 0 parse error / 全 RED。**

### 2.2 Wave 0 — L0C spec（已统一至 `tests/L0C/`）

> 这些 spec 不被根 `vitest.config.ts` 收集（设计如此：L0C 包内测试经由
> `pnpm --filter @harness/l0-core vitest run` 派发，T01-scaffold 自身即如此引用）。
> 现已随本次 commit 一并锁定。包 `@harness/l0-core` 同样未链接 / `src/index.ts` 为 `export {}` 占位，
> 故 T02–T11 在 suite 加载期失败 = 合法 RED。T01-scaffold 用相对路径 `../../src/index.ts` 导入，
> 可解析，故其 8 个用例实际执行。

| 任务 | 测试文件 | 测试数 | 失败模式 |
| --- | --- | --- | --- |
| L0C-T01 | `tests/L0C/T01-scaffold.spec.ts` | 8 | 见 §3 专项说明（5 GREEN / 3 RED，脚手架已存在） |
| L0C-T02 | `tests/L0C/T02-turn.spec.ts` | 9 | Cannot find module @harness/l0-core |
| L0C-T03 | `tests/L0C/T03-stop.spec.ts` | 15 | Cannot find module @harness/l0-core |
| L0C-T04 | `tests/L0C/T04-retry-overflow.spec.ts` | 5 | Cannot find module @harness/l0-core |
| L0C-T05 | `tests/L0C/T05-cache-cut.spec.ts` | 14 | Cannot find module @harness/l0-core |
| L0C-T06 | `tests/L0C/T06-memory-schema.spec.ts` | 25 | Cannot find module @harness/l0-core |
| L0C-T07a | `tests/L0C/T07a-runstate.spec.ts` | 10 | Cannot find module @harness/l0-core |
| L0C-T07b | `tests/L0C/T07b-session-log.spec.ts` | 6 | Cannot find module @harness/l0-core |
| L0C-T08 | `tests/L0C/T08-precommit.spec.ts` | 18 | Cannot find module @harness/l0-core |
| L0C-T11 | `tests/L0C/T11-readonly.spec.ts` | 16 | Cannot find module @harness/l0-core |
| **L0C 小计** | **10 文件** | **126 测试** | T02–T11 全 RED；T01 见 §3 |

**Wave 0 L0C 合计：10 文件 / 126 测试。**

## 3. L0C-T01 scaffold-acceptance 专项说明

`T01-scaffold.spec.ts` 是 L0C-T01（monorepo scaffold）的验收测试，**不是** "模块未实现" 型 RED 用例——
其被测对象就是 scaffold 本身，而 scaffold 已由初始 commit `38dc921` 落地为基线。故其中检验
scaffold 结构存在性的断言天然 GREEN，这不属于 "出题事故"（非空壳/非误测，而是对已交付基线的真实校验）。
其余 4 条断言校验尚未完成项，保持 RED。

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| `monorepo has 7 packages` | ✅ GREEN | scaffold 已建 7 包（基线事实） |
| `pnpm install produces lockfile with no peer warnings` | ✅ GREEN | install 可用、lockfile 存在（基线事实） |
| `pnpm -r build succeeds for all 7 packages` | ✅ GREEN | 各包 `tsc --noEmit` 对 `export {}` 通过（基线事实） |
| `directory tree matches WBS §2 seven package names exactly` | ✅ GREEN | 目录树与七包名表一致（基线事实） |
| `tsconfig strict enabled` | ❌ RED | `exactOptionalPropertyTypes` 未在 `tsconfig.base.json` 开启 |
| `verify.sh dispatches TASK-ID` | ❌ RED | `scripts/verify.sh` 尚未创建 |
| `exports L0_CORE_VERSION === 0.1.0` | ❌ RED | `src/index.ts` 仅 `export {}`，未导出 `L0_CORE_VERSION` |
| `vitest exits 0 with passWithNoTests` | ❌ RED | 根 gate 现有 18 个 RED spec，`pnpm -r run test` exit 1 |

> 这 4 条 GREEN 是 scaffold 基线的真实校验，非不合格的题；保留原样，待 L0C-T01 实现补齐
> `verify.sh` / `L0_CORE_VERSION` / `exactOptionalPropertyTypes` 后，剩余 4 条转 GREEN，
> 届时 T01 整体 GREEN 即标志 L0C-T01 完成。T01-scaffold **不在根 RED gate 收集范围内**，
> 故 §1 的 "0 通过" 结论不受其影响。

## 4. 合法性结论

- ✅ 根 RED gate（`pnpm vitest run`）18/18 suite 失败，0 测试通过，exit 1 —— 纯 RED，无出题事故。
- ✅ 失败模式全部为 `Cannot find module @harness/...`（合法 RED），无 transform / parse error；
  vitest 成功 collect 全部 18 个根 spec 文件。
- ✅ Wave 0 L0C 包内 spec（T02–T11）同为 `Cannot find module @harness/l0-core` 合法 RED；T01-scaffold 为
  scaffold 验收测试（4 GREEN 基线校验 + 4 RED 未完成钩子），已专项说明，非出题事故。
- ✅ 全部 28 个 spec 文件已随本次 commit 锁定。

## 5. 复现命令

```bash
cd <repo根>
pnpm vitest run                         # 根 RED gate（18 文件，全 RED）
pnpm --filter @harness/l0-core vitest run packages/l0-core/tests  # L0C 包内 spec（需先 wire test 脚本）
```
