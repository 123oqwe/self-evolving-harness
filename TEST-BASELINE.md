# TEST-BASELINE — RED Gate (wave 0 + 1)

> 生成于 RED 验证阶段。命令：`pnpm vitest run`。exit code = **1**（非 0，符合 RED 预期）。
>
> 全部被测模块尚未实现：`packages/*/src/index.ts` 均为 `export {}` 占位，且 `@harness/*` 工作区包未链接进 `node_modules`，故所有依赖包名导入的 spec 在 suite 加载期即失败 = 合法 RED（`Cannot find module @harness/...`）。

## 1. RED Gate 执行结果（`pnpm vitest run`）

> **勘误（W01 终验）**：Wave 0 L0C spec 已统一至 `tests/L0C/`（见 `TEST-LOCK.md` §2.1 注），故根 `vitest.config.ts` 的 `include: ["tests/**/*.spec.ts"]` 现收集全部 28 个文件（L0C 10 + L0S 14 + TL 4），而非早期基线记录的 18。下表为复核后的真实基线。

| 指标 | 值 |
| --- | --- |
| 收集到的 spec 文件 | **28**（全部位于 `tests/`，由 `vitest.config.ts` `include: ["tests/**/*.spec.ts"]` 圈定；L0C 已统一至 `tests/L0C/`） |
| 失败 suite | **28 / 28**（27 个为 suite 加载期 module-resolution 失败；1 个为 `T01-scaffold.spec.ts`，其 suite 可加载但有 3 个未完成项 it 失败） |
| 通过的测试 | **5**（全部位于 `tests/L0C/T01-scaffold.spec.ts`，为 scaffold 已交付基线的真实 GREEN 校验，非出题事故） |
| 失败的测试 | **3**（`T01-scaffold.spec.ts` 内 `tsconfig strict enabled` / `verify.sh dispatches TASK-ID` / `exports L0_CORE_VERSION === 0.1.0`） |
| transform / parse error | **0**（所有文件均被成功 transform/collect；27 个加载失败一律为 module-resolution load error，非语法崩坏） |
| 执行测试用例数 | 8（仅 `T01-scaffold.spec.ts` 进入 test 体；其余 27 文件在 suite 加载期失败，未进入 test 体） |
| exit code | 1 |

失败模式分布：

| 失败模式 | 命中文件数 | 合法 RED? |
| --- | --- | --- |
| `Failed to load url @harness/l0-sandbox ... Does the file exist?`（= Cannot find module @harness/l0-sandbox） | 14（L0S 全部） | ✅ 合法 RED |
| `Failed to load url @harness/telemetry ... Does the file exist?`（= Cannot find module @harness/telemetry） | 4（TL 全部） | ✅ 合法 RED |
| `Failed to load url @harness/l0-core ... Does the file exist?`（= Cannot find module @harness/l0-core） | 9（L0C T02–T11；T01-scaffold 用相对路径 `../../src/index.ts` 可解析） | ✅ 合法 RED |
| `T01-scaffold.spec.ts` 3 个未完成项 it 失败（tsconfig/verify.sh/L0_CORE_VERSION） | 1（T01-scaffold 自身） | ✅ 合法 RED（scaffold 待补项钩子） |
| transform / parse error | 0 | — |

> 注 1：`tests/L0S/T02.sandbox-platform-skip.spec.ts` 使用 `vi.mock("@harness/l0-sandbox")`，因同一根因（包不可解析）触发 vitest mock hoist 包装错误，**底层 cause 仍为 `Cannot find module @harness/l0-sandbox`**，属合法 RED，非语法错误。
>
> 注 2：`tests/L0C/T01-scaffold.spec.ts` 的 5 个 GREEN 是对已交付 scaffold 基线（commit `38dc921`）的真实校验（7 包结构 / install 无 peer warning / 7 包 build / 目录树一致 / vitest passWithNoTests），非空壳断言；3 个 RED 是尚未补齐的 `exactOptionalPropertyTypes` / `verify.sh` / `L0_CORE_VERSION` 钩子。详见 §3。

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

### 2.2 Wave 0 — L0C spec（已统一至 `tests/L0C/`，被根 `vitest.config.ts` 收集）

> **勘误（W01 终验）**：早期基线称「L0C spec 不被根 vitest 收集」——该描述已过时。L0C spec 现统一至 `tests/L0C/`（见 `TEST-LOCK.md` §2.1 注），根 `vitest.config.ts` 的 `include: ["tests/**/*.spec.ts"]` 现收集全部 10 个 L0C 文件。
> 包 `@harness/l0-core` 同样未链接 / `src/index.ts` 为 `export {}` 占位，
> 故 T02–T11 在 suite 加载期失败 = 合法 RED（`Cannot find module @harness/l0-core`）。T01-scaffold 用相对路径 `../../src/index.ts` 导入，
> 可解析，故其 8 个用例实际执行（5 GREEN 基线校验 + 3 RED 未完成钩子）。

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
其余 3 条断言校验尚未完成项，保持 RED。

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| `monorepo has 7 packages` | ✅ GREEN | scaffold 已建 7 包（基线事实） |
| `pnpm install produces lockfile with no peer warnings` | ✅ GREEN | install 可用、lockfile 存在（基线事实） |
| `pnpm -r build succeeds for all 7 packages` | ✅ GREEN | 各包 `tsc --noEmit` 对 `export {}` 通过（基线事实） |
| `directory tree matches WBS §2 seven package names exactly` | ✅ GREEN | 目录树与七包名表一致（基线事实） |
| `tsconfig strict enabled` | ❌ RED | `exactOptionalPropertyTypes` 未在 `tsconfig.base.json` 开启 |
| `verify.sh dispatches TASK-ID` | ❌ RED | `scripts/verify.sh` 尚未创建 |
| `exports L0_CORE_VERSION === 0.1.0` | ❌ RED | `src/index.ts` 仅 `export {}`，未导出 `L0_CORE_VERSION` |
| `vitest exits 0 with passWithNoTests` | ✅ GREEN | `pnpm -r run test` 走逐包 vitest（各包 tests 目录空 + `passWithNoTests`）exit 0；注：该 it 跑的是逐包 `pnpm -r run test` 而非根 `pnpm vitest run`，故不受根 gate 28 文件 RED 影响（勘误：早期基线误标 RED） |

> 这 5 条 GREEN 是 scaffold 基线的真实校验，非不合格的题；保留原样，待 L0C-T01 实现补齐
> `verify.sh` / `L0_CORE_VERSION` / `exactOptionalPropertyTypes` 后，剩余 3 条转 GREEN，
> 届时 T01 整体 GREEN 即标志 L0C-T01 完成。T01-scaffold 现已被根 RED gate 收集（L0C 统一至 `tests/L0C/` 后），
> 故 §1 的「28 文件 / 5 通过 / 3 失败」结论包含其贡献；该 5 GREEN 仍非出题事故（对已交付基线的真实校验）。

## 4. 合法性结论

- ✅ 根 RED gate（`pnpm vitest run`）28 文件全计：27 suite 加载期失败（`Cannot find module @harness/...`）+ 1 个 `T01-scaffold`（5 GREEN 基线校验 + 3 RED 未完成钩子）；exit 1 —— 合法 RED，无出题事故。
- ✅ 失败模式全部为 `Cannot find module @harness/...`（合法 RED）+ T01 的 3 个未完成项钩子，无 transform / parse error；
  vitest 成功 collect 全部 28 个根 spec 文件。
- ✅ Wave 0 L0C spec（T02–T11）同为 `Cannot find module @harness/l0-core` 合法 RED；T01-scaffold 为
  scaffold 验收测试（5 GREEN 基线校验 + 3 RED 未完成钩子），已专项说明，非出题事故。
- ✅ 全部 28 个 spec 文件已随本次 commit 锁定。

## 5. 复现命令

```bash
cd <repo根>
pnpm vitest run                         # 根 RED gate（28 文件，exit 1）
pnpm --filter @harness/l0-core vitest run tests/L0C   # L0C spec（现统一至 tests/L0C/，根 gate 已含）
```
