# TEST-LOCK — 出题权分离锁定套件（Wave 0 + 1）

> **角色**：test-author（隔离出题人，与 implementer 异上下文）
> **生成命令**：`shasum -a 256`（每文件 sha256）
> **配套文档**：`TEST-BASELINE.md`（RED 门基线 + 失败模式分布）。
> **本文件回答**：Wave 0 + 1 的测试文件清单与 sha256 锁定值，以及 implementer 不得改动测试的锁定规则。
>
> 所有 hash 由 `shasum -a 256 <file>` 在 repo 根目录下计算；路径相对 repo 根（`<repo根>`）。

## 1. 锁定规则声明

### 1.1 出题权分离（separation of test-authorship）

- **测试由隔离的 `test-author` 从 spec 生成并锁定**，与 `implementer` 不共享 session/上下文（09-EXECUTION-GRAPH 铁律 5）。`test-author` 只读 spec + 契约，不读 `implementer` 的实现或 NL summary。
- `implementer` 对 `tests/` 下已锁定文件**只读**——即对 `tests/**/*.spec.ts` 与 `packages/*/tests/**/*.spec.ts` 目录树下的任何 `.spec.ts` 文件只读（OS sandbox + L0C-T11 + reviewer 双层守卫）。

### 1.2 锁定与驳回规则

- **锁定生效**：本文件 §2 表中每一行的 `sha256` 即该测试文件的锁定值。`implementer` 领单时由 `verify.sh` 或 test-lock 门重新计算 sha256 并与本表比对——hash 不变 = 锁定完好。
- **直接 reject**：`implementer` 的 diff 若触碰 `tests/` 下任一已锁定文件（含内容改动、删行、重命名、新增用例、改 import）——`reviewer` 不进入对抗审查，直接 verdict=`reject`，round 计数 +1；附 reason=`test-lock-violation`。
- **唯一修订通道**（测试有错的唯一合法路径）：
  1. `implementer` 向 `test-author` 申诉（提交申诉单：task ID + 测试文件 + 失败证据 + 申诉理由，不得自行改测试）。
  2. `test-author` 重新读 spec 判定：确属出题错误 → 修订测试文件 → 重新计算 sha256 → 更新本表 §2 对应行 hash → 落 commit（commit message 前缀 `test-lock:`）。
  3. 修订后**重新跑 RED 门**（`pnpm vitest run`）确认修订后的测试在"未实现"态下仍合法 RED（或对已实现态仍合法 GREEN），RED 门证据落 `TEST-BASELINE.md`。
  4. 仅当 1-3 全部完成，`implementer` 才可在新 hash 下重新领单。
- **禁止行为**：`implementer` 自行注释 / skip / 删除测试用例、把 `expect(...)` 改宽、加 `.todo`/`.skip`、改 import 路径使测试"碰巧转绿"——一律 `test-lock-violation` 直接 reject，不进 reviewer 对抗审查。

### 1.3 锁定范围

本表锁定 Wave 0（L0C 包内 spec）+ Wave 1（L0S / TL 根级 spec）的全部 28 个 `.spec.ts` 文件。Wave 2+ 的测试在每个波次**开始前**由 `test-author` 团队批量生成并锁定（just-in-time，不预写 V1/V2，见 `execution/README.md` 领取协议）。新锁定的文件追加到本表 §2，并由 test-author 落 `test-lock:` commit。

## 2. 测试文件清单 + sha256（Wave 0 + 1）

### 2.1 Wave 0 — L0C 包内 spec（`packages/l0-core/tests/L0C/`）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L0C-T01 | `packages/l0-core/tests/L0C/T01-scaffold.spec.ts` | `c71e540ec1c97c0363e756c8013692871c5cfd45bb3c7b887b16cd1222244dbb` |
| L0C-T02 | `packages/l0-core/tests/L0C/T02-turn.spec.ts` | `f025a591e617f0f1ebd9b8a0648a93560c0309d786583c545d4193dc7b53dddd` |
| L0C-T03 | `packages/l0-core/tests/L0C/T03-stop.spec.ts` | `95eece03e222360b92b52ba82c5e785275a6bd07b111357039b4783d80440897` |
| L0C-T04 | `packages/l0-core/tests/L0C/T04-retry-overflow.spec.ts` | `b2b39dc95874365670b16be4a8476c428f017d6a8dbf98fb50feb033d46410ae` |
| L0C-T05 | `packages/l0-core/tests/L0C/T05-cache-cut.spec.ts` | `4b99095c1a489930b4407ecab42071fd44640bbe1c0f803233a3d65ae4ae80de` |
| L0C-T06 | `packages/l0-core/tests/L0C/T06-memory-schema.spec.ts` | `06eb747d6c29f6e940ae758bb51c6720f71a4b942a7d7b7e78d3677591b5be78` |
| L0C-T07a | `packages/l0-core/tests/L0C/T07a-runstate.spec.ts` | `4cedd0311d16c440103a7df292457cd443866622065f14d4d67f2e899c87e84a` |
| L0C-T07b | `packages/l0-core/tests/L0C/T07b-session-log.spec.ts` | `105e80a9997612da6e182563e6f017ecc9f357b41172a80532dbe93ce9ae3ae5` |
| L0C-T08 | `packages/l0-core/tests/L0C/T08-precommit.spec.ts` | `170d024576f7123f87aa16162b5588e315a9556028d9acf8e32a83c8e5a8e74e` |
| L0C-T11 | `packages/l0-core/tests/L0C/T11-readonly.spec.ts` | `634ae239ccc8c8de230a3d1f92c2ecb9f0964fdbfc568302a88d9eec6c349d6b` |

> **L0C 小计**：10 文件 / 126 测试（详见 `TEST-BASELINE.md` §2.2）。T01-scaffold 为 scaffold 验收测试（4 GREEN 基线校验 + 4 RED 未完成钩子），非出题事故，仍锁定。

### 2.2 Wave 1 — L0S 根级 spec（`tests/L0S/`）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L0S-T01 | `tests/L0S/T01.brain-no-credential.spec.ts` | `e5e30da2d67c58c328a80f5f0699b6ce24c3bade528d2183d87ba2b234b087cb` |
| L0S-T01 | `tests/L0S/T01.session-log-append-only.spec.ts` | `ab137ca33defd1a7f165b156687d3f299f4cf4db2d2ae64ff435f659febfcb0c` |
| L0S-T01 | `tests/L0S/T01.session-wake-idempotent.spec.ts` | `dd45317e254523bdad78a9ff8d8c8aa23c4844e8b502f4a673babe04fb4944b7` |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-egress.spec.ts` | `308877ac725e513199d3577ae5dd04087ea2ded68fedd4fa970aead474a40ce8` |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-ssh.spec.ts` | `649da92e7eccc8e30651ce21e364ad017f2cf9f71308fcbc84d12ba29e62aeac` |
| L0S-T02 | `tests/L0S/T02.sandbox-platform-skip.spec.ts` | `fc01dbe0aea1d847cadff32b011e2076d63cb5f461f5801895e6a00a368ae5c8` |
| L0S-T03 | `tests/L0S/T03.deny-read-ssh.spec.ts` | `eae750a9ad05d908492d3776b3c6b6b9a34f0023d7abf8d15b22b04cdac0383d` |
| L0S-T03 | `tests/L0S/T03.narrower-allow-reopens.spec.ts` | `529893d41bfbdd779a1e771202b44b5e35298f137b05b6d8ea58d51b0aa56a7f` |
| L0S-T03 | `tests/L0S/T03.symlink-bypass-blocked.spec.ts` | `22e03e9b36bf54c429544bca4ae10fd1d2913668ed8c58e9c9bb23dd56055256` |
| L0S-T03 | `tests/L0S/T03.worktree-write-scoped.spec.ts` | `9ec24eb8f23d479eef01e51f8abb0b3f810705c46769ebea145aa96b85417645` |
| L0S-T06 | `tests/L0S/T06.concurrency-limit.spec.ts` | `e7c84e4b4055a63e58f465e49c38743326b8e791148a3d2a4519eeab77eb7ce8` |
| L0S-T06 | `tests/L0S/T06.orphan-list.spec.ts` | `40fbd93ad8fac52983392a792cd67be92e8280347af37374cc26984dd66edccc` |
| L0S-T06 | `tests/L0S/T06.teardown-on-throw.spec.ts` | `a087f6402e485ed11a9ee5c1ef5bab987ea25d6bb9359b8fe512f7ac1d53af26` |
| L0S-T06 | `tests/L0S/T06.timeout-kills.spec.ts` | `49ef95e04051a904e2f47f6417afbb1b7a314daa23d78640bc7d6ffb36e6bb57` |

> **L0S 小计**：14 文件 / 35 测试，全 RED（`Cannot find module @harness/l0-sandbox`，详见 `TEST-BASELINE.md` §2.1）。

### 2.3 Wave 1 — TL 根级 spec（`tests/TL/`）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| TL-T01 | `tests/TL/T01-transcript.spec.ts` | `f8debcc22bf39d6cd8f0bdb31b8d85253cd6181e8a679bfe104645474cf54246` |
| TL-T02 | `tests/TL/T02-usage.spec.ts` | `32f2fffa280383d368567b5d664559ca9f9fc95e7bc521d9721922e9724eb1a6` |
| TL-T05 | `tests/TL/T05-schema-policy.spec.ts` | `5e83215f60db6fa6126e5c2de9382e4ad05cd9abdfa8198658e736fb86f03f41` |
| TL-T06 | `tests/TL/T06-budget-policy.spec.ts` | `f22328e796b7eccdacb6fdaa4110c3c7f80fbd9f9e952f7c1200828a50b15bed` |

> **TL 小计**：4 文件 / 27 测试，全 RED（`Cannot find module @harness/telemetry`，详见 `TEST-BASELINE.md` §2.1）。

### 2.4 锁定合计

| 波次 | 模块 | 文件数 | 测试数 |
| --- | --- | --- | --- |
| Wave 0 | L0C | 10 | 126 |
| Wave 1 | L0S | 14 | 35 |
| Wave 1 | TL | 4 | 27 |
| **合计** | | **28** | **188** |

## 3. 复现命令

```bash
cd <repo根>
# 重算全部锁定 hash（须与本表 §2 一致）
find tests packages/l0-core/tests -name '*.spec.ts' | sort \
  | while read f; do shasum -a 256 "$f"; done
# RED 门基线（详见 TEST-BASELINE.md）
pnpm vitest run
```

> 若 §3 重算结果与本表 §2 任一行不一致 → 测试文件被改动 → 触发 `test-lock-violation`，按 §1.2 唯一通道处理（test-author 申诉 → 修订 → 重锁 → 重跑 RED 门）。
