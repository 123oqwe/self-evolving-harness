# TEST-LOCK — 出题权分离锁定套件（全量预锁定：Wave 0 + 1 + 2）

> **角色**：test-author（隔离出题人，与 implementer 异上下文）
> **生成命令**：`shasum -a 256`（每文件 sha256）
> **配套文档**：`TEST-BASELINE.md`（RED 门基线 + 失败模式分布）、`execution/README.md` §领取协议（全量预锁定 + 申诉通道）、`execution/09-EXECUTION-GRAPH.md` §2.3。
> **本文件回答**：主计划全部已落地测试文件的清单与 sha256 锁定值，以及 implementer 不得改动测试的锁定规则。
>
> 所有 hash 由 `shasum -a 256 <file>` 在 repo 根目录下计算；路径相对 repo 根（`<repo根>`）。

## 1. 锁定规则声明

### 1.1 出题权分离（separation of test-authorship）

- **测试由隔离的 `test-author` 从 spec 生成并锁定**，与 `implementer` 不共享 session/上下文（09-EXECUTION-GRAPH 铁律 5）。`test-author` 只读 spec + 契约，不读 `implementer` 的实现或 NL summary。
- `implementer` 对 `tests/` 下已锁定文件**只读**——即对 `tests/**/*.spec.ts` 与 `packages/*/tests/**/*.spec.ts` 目录树下的任何 `.spec.ts` 文件只读（OS sandbox + L0C-T11 + reviewer 双层守卫）。

### 1.2 锁定与驳回规则

- **锁定生效**：本文件 §2 表中每一行的 `sha256` 即该测试文件的锁定值。`implementer` 领单时由 `verify.sh` 或 test-lock 门重新计算 sha256 并与本表比对——hash 不变 = 锁定完好。
  - **代码层兑现（非仅社交契约）**：`scripts/lib/test-lock-check.mjs` 解析本表 §2、重算每个锁定文件 sha256 并比对，篡改/删除/新增未锁定测试即 exit 1。三层强制：
    1. `scripts/verify.sh` 领单入口（`dispatch_task` 前先跑 test-lock-check）；
    2. `.github/workflows/ci.yml` 的 `test-lock` job（不可绕过，先于 sentinel/full-suite）；
    3. `scripts/install-pre-commit.sh` 安装的 `.git/hooks/pre-commit`（本地快反馈，`--no-verify` 可绕但 CI 为硬后盾）。
  - `scripts/lib/mutate-invariant.sh` 的 `run_gate` 入口亦先比对 §2 规范 hash（非仅 before==after），杜绝在已篡改脏基线上跑突变门。
- **直接 reject**：`implementer` 的 diff 若触碰 `tests/` 下任一已锁定文件（含内容改动、删行、重命名、新增用例、改 import）——`reviewer` 不进入对抗审查，直接 verdict=`reject`，round 计数 +1；附 reason=`test-lock-violation`。
- **唯一修订通道**（测试有错的唯一合法路径）：
  1. `implementer` 向 `test-author` 申诉（提交申诉单：task ID + 测试文件 + 失败证据 + 申诉理由，不得自行改测试）。
  2. `test-author` 重新读 spec 判定：确属出题错误 → 修订测试文件 → 重新计算 sha256 → 更新本表 §2 对应行 hash → 落 commit（commit message 前缀 `test-lock:`）。
  3. 修订后**重新跑 RED 门**（`pnpm vitest run`）确认修订后的测试在"未实现"态下仍合法 RED（或对已实现态仍合法 GREEN），RED 门证据落 `TEST-BASELINE.md`。
  4. 仅当 1-3 全部完成，`implementer` 才可在新 hash 下重新领单。
- **禁止行为**：`implementer` 自行注释 / skip / 删除测试用例、把 `expect(...)` 改宽、加 `.todo`/`.skip`、改 import 路径使测试"碰巧转绿"——一律 `test-lock-violation` 直接 reject，不进 reviewer 对抗审查。

### 1.3 锁定范围（全量预锁定；废止 per-wave JIT 出题）

- **政策**：主计划全部 120 任务（117 + 3 CLN，见 `execution/README.md` §领取协议 + `execution/09-EXECUTION-GRAPH.md` §2.3）的锁定测试由隔离 `test-author` 从 spec **一次性预生成并锁定**。**废止原 per-wave just-in-time 出题政策**（先例见 `09-EXECUTION-GRAPH.md` §2.3 + `ERRATA-w01.md` 本轮记录）：预锁定使 implementer 领单时 spec/测试/锁三方已一致。
- **本表锁定范围**：`tests/` 下已落地的全部 153 个 `.spec.ts` 文件（Wave 0 L0C + Wave 1 L0S/TL + Wave 2 L1/L2/L3/CE/XM/gates），逐文件 sha256 见 §2.1–§2.9。
- **例外（无锁定测试文件）**：3 个可行性 spike（`CE-T00a/b/c`，`[MVP-spike]`）只产 spike 报告 `research/spikes/CE-T00*.md`，不产 `.spec.ts`，不计入本表；`CLN-T01` 为 schema 迁移（额外补 `tests/cleanup/T01-typebox-migration.spec.ts` 锁定 spec + 沿用 L0C-T03/T06 锁定 spec 验收）；CLN 清理 spec（`tests/cleanup/T01|T02|T03`）已由 test-author 落地并锁定见 §2.10。
- **新增锁定**：后续新落地的测试文件由 test-author 追加到本表 §2 对应小节，并落 `test-lock:` commit；申诉裁决同步记入 `ERRATA-w<NN>.md`。

## 2. 测试文件清单 + sha256（全量预锁定）

### 2.1 — L0C spec（`tests/L0C/`，14 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L0C-T01 | `tests/L0C/T01-scaffold.spec.ts` | `139000a5bdb39088dfafa85ada67f6626a5959d303f32dcf1f9e76b3a43963a1` |
| L0C-T02 | `tests/L0C/T02-turn.spec.ts` | `f025a591e617f0f1ebd9b8a0648a93560c0309d786583c545d4193dc7b53dddd` |
| L0C-T03 | `tests/L0C/T03-stop.spec.ts` | `95eece03e222360b92b52ba82c5e785275a6bd07b111357039b4783d80440897` |
| L0C-T04 | `tests/L0C/T04-retry-overflow.spec.ts` | `7cd6524fc4ced7302dce9b5dd5dc783b662e58a31cd178ab58f0d0e9f99ab3c3` |
| L0C-T05 | `tests/L0C/T05-cache-cut.spec.ts` | `4b99095c1a489930b4407ecab42071fd44640bbe1c0f803233a3d65ae4ae80de` |
| L0C-T06 | `tests/L0C/T06-memory-schema.spec.ts` | `06eb747d6c29f6e940ae758bb51c6720f71a4b942a7d7b7e78d3677591b5be78` |
| L0C-T07a | `tests/L0C/T07a-runstate.spec.ts` | `4cedd0311d16c440103a7df292457cd443866622065f14d4d67f2e899c87e84a` |
| L0C-T07b | `tests/L0C/T07b-session-log.spec.ts` | `105e80a9997612da6e182563e6f017ecc9f357b41172a80532dbe93ce9ae3ae5` |
| L0C-T08 | `tests/L0C/T08-precommit.spec.ts` | `170d024576f7123f87aa16162b5588e315a9556028d9acf8e32a83c8e5a8e74e` |
| L0C-T10 | `tests/L0C/T10-breaker.spec.ts` | `48cab437d22731829d1b5a33b52f93678d1ccd48ce4c6f88818151a8d1ab7a1e` |
| L0C-T11 | `tests/L0C/T11-readonly.spec.ts` | `634ae239ccc8c8de230a3d1f92c2ecb9f0964fdbfc568302a88d9eec6c349d6b` |
| L0C-T09a | `tests/L0C/invariants-A.spec.ts` | `c5b5da02fbb07e9f42e8fd3ab11bfe8c7846f33d0a45bb5a30bc4610790dfef0` |
| L0C-T09b | `tests/L0C/invariants-B.spec.ts` | `85286df55f40c8edb928f12da10a647b02cbb54294703bcc381f33d20531a815` |
| L0C-T12 | `tests/L0C/redteam.spec.ts` | `e89b77627254239b650640fdfeaaf331ce78b71965e390060d439f7a30ccfcac` |

### 2.2 — L0S 根级 spec（`tests/L0S/`，52 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L0S-T01 | `tests/L0S/T01.brain-no-credential.spec.ts` | `e5e30da2d67c58c328a80f5f0699b6ce24c3bade528d2183d87ba2b234b087cb` |
| L0S-T01 | `tests/L0S/T01.session-log-append-only.spec.ts` | `ab137ca33defd1a7f165b156687d3f299f4cf4db2d2ae64ff435f659febfcb0c` |
| L0S-T01 | `tests/L0S/T01.session-wake-idempotent.spec.ts` | `dd45317e254523bdad78a9ff8d8c8aa23c4844e8b502f4a673babe04fb4944b7` |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-egress.spec.ts` | `308877ac725e513199d3577ae5dd04087ea2ded68fedd4fa970aead474a40ce8` |
| L0S-T02 | `tests/L0S/T02.sandbox-deny-ssh.spec.ts` | `649da92e7eccc8e30651ce21e364ad017f2cf9f71308fcbc84d12ba29e62aeac` |
| L0S-T02 | `tests/L0S/T02.sandbox-platform-skip.spec.ts` | `b53e9694b7e36a7d1eb407f8f63f665dd51cb14ea54bad5a625110bcabe4a85d` |
| L0S-T03 | `tests/L0S/T03.deny-read-ssh.spec.ts` | `eae750a9ad05d908492d3776b3c6b6b9a34f0023d7abf8d15b22b04cdac0383d` |
| L0S-T03 | `tests/L0S/T03.narrower-allow-reopens.spec.ts` | `529893d41bfbdd779a1e771202b44b5e35298f137b05b6d8ea58d51b0aa56a7f` |
| L0S-T03 | `tests/L0S/T03.symlink-bypass-blocked.spec.ts` | `22e03e9b36bf54c429544bca4ae10fd1d2913668ed8c58e9c9bb23dd56055256` |
| L0S-T03 | `tests/L0S/T03.worktree-write-scoped.spec.ts` | `9ec24eb8f23d479eef01e51f8abb0b3f810705c46769ebea145aa96b85417645` |
| L0S-T04a | `tests/L0S/T04a.allowlist-subdomain.spec.ts` | `113f6076c309a7f4601731cd1c114c7d78860a43b50a7c96dfdf8239408aa7cc` |
| L0S-T04a | `tests/L0S/T04a.dns-rebinding-blocked.spec.ts` | `2cb12ad6f866093337c3b4d113c85ac705b940af18ba7ea2e8e75c131db98d72` |
| L0S-T04a | `tests/L0S/T04a.non-allowlist-denied.spec.ts` | `db62d945f1ef485615504420160c5ede9e81988d1f1f7a964864cb327a4529bb` |
| L0S-T04a | `tests/L0S/T04a.proxy-egress-log.spec.ts` | `509f8065f1d234e209f9b40f42d6509f29c5a833bab566b6b0976c07a0d6e4ee` |
| L0S-T04b | `tests/L0S/T04b.egress-no-real-secret.spec.ts` | `cb1326c906b282f157016fa1467bcbd069bb0ba40b745ae16ae6fb71bc38c0a8` |
| L0S-T04b | `tests/L0S/T04b.env-strip.spec.ts` | `c394bfac4ac20f2e6310f527e9c1f8dcc1832b1c49b798fb035302d124478b89` |
| L0S-T04b | `tests/L0S/T04b.injectHosts-subset.spec.ts` | `6d0bf0700c558e5553c074bb11673f1aafa9e1aeb79d8b67593df10dc0149b69` |
| L0S-T04b | `tests/L0S/T04b.log-redact.spec.ts` | `87dfa69b6de5624adf698aef4942b2b3eede041c6bc73b9b729ab47b6af18b33` |
| L0S-T04b | `tests/L0S/T04b.sigv4-resign.spec.ts` | `0c0ed6190af6eab869054790e7518da711a6bd868af40430465028cf84b8a30b` |
| L0S-T05 | `tests/L0S/T05.exfil-detected.spec.ts` | `7cc785be864c8967c230bee557ef0774a7bd9c3fd77b7d48aff524bdfef69f13` |
| L0S-T05 | `tests/L0S/T05.injecthost-egress-not-counted.spec.ts` | `f33c82feb52b0cafc8850e77f67210dc8548303d657ed3b397c7d326cf6a3dc5` |
| L0S-T05 | `tests/L0S/T05.no-leak-on-clean-run.spec.ts` | `c53b5e90749b65b22eec60370ed5e90e088eb5377ec0afbedfdbeb7cf3ca3bf0` |
| L0S-T06 | `tests/L0S/T06.concurrency-limit.spec.ts` | `e7c84e4b4055a63e58f465e49c38743326b8e791148a3d2a4519eeab77eb7ce8` |
| L0S-T06 | `tests/L0S/T06.orphan-list.spec.ts` | `40fbd93ad8fac52983392a792cd67be92e8280347af37374cc26984dd66edccc` |
| L0S-T06 | `tests/L0S/T06.teardown-on-throw.spec.ts` | `a087f6402e485ed11a9ee5c1ef5bab987ea25d6bb9359b8fe512f7ac1d53af26` |
| L0S-T06 | `tests/L0S/T06.timeout-kills.spec.ts` | `49ef95e04051a904e2f47f6417afbb1b7a314daa23d78640bc7d6ffb36e6bb57` |
| L0S-T07 | `tests/L0S/T07.monotonic-tighten.spec.ts` | `1ae5d550af37ffc24b9196f687eba20be30e72695288d3817709f3d03902a876` |
| L0S-T07 | `tests/L0S/T07.self-deny-read.spec.ts` | `c220bc48517ad94c26321dfd9408ba26186b205272d9845602e1fb3fcc619ea8` |
| L0S-T07 | `tests/L0S/T07.sha256-verify.spec.ts` | `87e070ecdd9c5e0d88ff6cd78f730dbe73448de8fd2e6ab59b9607a9bf8b9579` |
| L0S-T08 | `tests/L0S/T08.allow-relax-needs-signoff.spec.ts` | `7df72235d32f0ca1909bb030c95e1e167ca7f5b9a66e7b47b5444a87700f63dc` |
| L0S-T08 | `tests/L0S/T08.allow-with-signoff.spec.ts` | `0f549c8d6fa4a8598326240b76edd7c23c02ca4beb371d416a34445c0b4ae224` |
| L0S-T08 | `tests/L0S/T08.deny-tighten-auto.spec.ts` | `27bebebb19f643741dd1ce5362398a727192db728a0035c34403a1f21d1d9e81` |
| L0S-T09 | `tests/L0S/T09.breaker-rejects-relaxation.spec.ts` | `1ab9348d94f62dfc6e1ccf41196dceff75c013f698bf45a8b7cadcfc856fae72` |
| L0S-T09 | `tests/L0S/T09.debiased-consistency.spec.ts` | `2b9a618cba210de63496e0028babd4d1d9542109672b1c3e52b4ac5007de87c9` |
| L0S-T09 | `tests/L0S/T09.safety-suite-f1.spec.ts` | `dfc134e2b750b8b8b5b28faaf44959f46f4daa2c3127e2b39be117a353cf722b` |
| L0S-T10 | `tests/L0S/T10.diff-exists.spec.ts` | `95436a6c60f023a65343301d3a7a49d032c78d13942f87ecb5a43f454f53292e` |
| L0S-T10 | `tests/L0S/T10.never-auto-delete.spec.ts` | `0e012675b3bf856988c9557cbecf538add8bf3b4580a18e4c6ec7a9b1d13799f` |
| L0S-T10 | `tests/L0S/T10.orphan-count-decreases.spec.ts` | `78faaaeb0252f1d12e31e7737a838e87c6803255629c00f14ce86631a9cc8ad2` |
| L0S-T11 | `tests/L0S/T11.canary-zero-tolerance.spec.ts` | `84276b78aa56e942112c899cb3189293574126e22e7e689470a471ea19a6296e` |
| L0S-T11 | `tests/L0S/T11.injecthost-needs-signoff-and-subset.spec.ts` | `71cfc309e5375ddeb41fd8f3f9cd277d009e13b6b009e0dc9c84c7d71a3e041e` |
| L0S-T11 | `tests/L0S/T11.sensitive-env-tighten.spec.ts` | `3cf16ee15bfb69c4f354237741c0578b7314c15cf4adcdf819e5f7586054c7db` |
| L0S-T12 | `tests/L0S/T12.contract-unchanged.spec.ts` | `03f10ea4bbd0c5177c1a42403bdb82e216c692da034b497a8f8436060831067f` |
| L0S-T12 | `tests/L0S/T12.dual-verifier.spec.ts` | `95d018dfb167df23bf65f99908bde648cea978814f893fc3b94b3f1df21d2fc5` |
| L0S-T12 | `tests/L0S/T12.needs-signoff.spec.ts` | `5ad90fb71cbf8ce782d21a9cece122ed303be30b5f9c7501764ca6e9f685eb29` |
| L0S-T12 | `tests/L0S/T12.security-degradation-rejected.spec.ts` | `38bde39171aef0481af6ed9dd87946c11228e1ee98f1d61acf8144fff96d0575` |
| L0S-T13 | `tests/L0S/T13.abc-empty-response.spec.ts` | `2e68f8782255b14c72f28c277659001db1a2714008c3c8c1b22b1675406dd141` |
| L0S-T13 | `tests/L0S/T13.canary-payload-sha256.spec.ts` | `eb1a0c317e002020028f83672cccf432375ef436703c9c42fb66b7cc5d0812d4` |
| L0S-T13 | `tests/L0S/T13.monotonic-stricter.spec.ts` | `527089ab21831b478c4645a3db859b5889f59ce0dd4a5f37bcf93b6eff434055` |
| L0S-T14 | `tests/L0S/T14.etc-passwd-blocked.spec.ts` | `2827ae9f4474af5fdfe447e0ce69f5cd901f0627822bfe8fe21ac1b78d87748c` |
| L0S-T14 | `tests/L0S/T14.metadata-blocked.spec.ts` | `10963097ad821a43186724593e1540f9d79487347f88c44382be651046f95d6d` |
| L0S-T14 | `tests/L0S/T14.ssh-read-blocked.spec.ts` | `6cd253c89e4db123053ff9e85a3239283cb8ed3e4746c33d08aa02bf5731ab76` |
| L0S-T14 | `tests/L0S/T14.zero-escape.spec.ts` | `d79a45f684311c88cde93f1d9e026cfa1b175fad13ee78b06e2ac8881df09cd2` |

### 2.3 — TL 根级 spec（`tests/TL/`，12 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| TL-T01 | `tests/TL/T01-transcript.spec.ts` | `c53d4a995262dd85717efb4f5f8ca74903d077b7d695a6f182ef65b66a87c1ed` |
| TL-T02 | `tests/TL/T02-usage.spec.ts` | `32f2fffa280383d368567b5d664559ca9f9fc95e7bc521d9721922e9724eb1a6` |
| TL-T03 | `tests/TL/T03-otel.spec.ts` | `950e221facde5892a8a1cc8ab1eadb1011d4f88e07bde968cf4f2dc22512fa15` |
| TL-T04 | `tests/TL/T04-replay.spec.ts` | `552e1f2b4c344ad8f61de70c595b57ae952383291dca0dea821dac9c93c7bf87` |
| TL-T05 | `tests/TL/T05-schema-policy.spec.ts` | `5e83215f60db6fa6126e5c2de9382e4ad05cd9abdfa8198658e736fb86f03f41` |
| TL-T06 | `tests/TL/T06-budget-policy.spec.ts` | `f22328e796b7eccdacb6fdaa4110c3c7f80fbd9f9e952f7c1200828a50b15bed` |
| TL-T07 | `tests/TL/T07-capture-policy.spec.ts` | `ef80a695c2e8a687637a7604cd415570a17f9658629f4d43c10d8b7a3e6a7b30` |
| TL-T08 | `tests/TL/T08-clustering.spec.ts` | `608b425e832325fe24fd29c9804eb9851e20bb368cee609b5fd1d598aa87ab74` |
| TL-T09 | `tests/TL/T09-distill-selector.spec.ts` | `414ba152789ebb4d6424f93e3038f67ff9e796ae4549607cb2306d3a22f5d5f6` |
| TL-T10 | `tests/TL/T10-flywheel.spec.ts` | `59ec05c8383eb5d5cc57ecc29977663ea1066087c057efe490ec503f7b906bf5` |
| TL-T11 | `tests/TL/T11-insight.spec.ts` | `2807965f69dbf3b66525e3994a9893f3084ee70c4e5b7e1a1450c385a79c4322` |
| TL-T12 | `tests/TL/T12-otlp-backend.spec.ts` | `e8aafdfdd91be793ec0b8e92d5d1d70667884b496ee30fe49e15793cef6eb2bf` |

### 2.4 — L1 spec（`tests/L1/`，24 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L1-T01 | `tests/L1/T01-repo-layout.spec.ts` | `9b7d8d58aa6ef6adc2bb3313a089e733920ae839f94b84c69a9e6e934e1ccb83` |
| L1-T02 | `tests/L1/T02-compaction-substrate.spec.ts` | `df87c4e1c9b60c07590411c6753801e2392732d53789f1abc6dd6d27fde29712` |
| L1-T03 | `tests/L1/T03-signature-phase.spec.ts` | `013fa0bb818a1630dd0a4834cd0316078dc0a38b1eef5adcb1bb43d973ed0679` |
| L1-T04a | `tests/L1/T04a-evolution-driver.spec.ts` | `74d947674a94d5035e338e7abdaa39b14d4ef974e99a59685f539b53b4b99431` |
| L1-T04b | `tests/L1/T04b-select-retain.spec.ts` | `ef204c4372772ce8f0c989ea9acd9edc5ef0450b487b06ff19e4538c2d2ac86b` |
| L1-T05a | `tests/L1/T05a-phase-evolution-driver.spec.ts` | `60e375fce794f5c532a1759a5f2ccbd911048309c603fe3ad8a04ac1e586db70` |
| L1-T05b | `tests/L1/T05b-phase-select-retain.spec.ts` | `34436d854aa93ced6985747bd991e53e96be2dac50188961ccbe484fc940db9f` |
| L1-T06 | `tests/L1/T06-tool-registry.spec.ts` | `2a6fc97516800f3f895fd65f2aef1e0fa6ab39ccd5d5affb2acb2c1ee79e2a05` |
| L1-T07 | `tests/L1/T07-tool-evolution.spec.ts` | `07f476e4c7c3837dcd75bdc31dada16e5b8599e63a9b3e41d3618ea76f3568d1` |
| L1-T08 | `tests/L1/T08-tool-subset-defer.spec.ts` | `830b5601d7b9ea517460148e3a30a8569a1a452e9c297d28316a04bb2c06eb28` |
| L1-T09 | `tests/L1/T09-history-processors.spec.ts` | `70ad47331bd2b713910e7b965ddd06875c904df003d783413885ef9f5989028d` |
| L1-T10 | `tests/L1/T10-truncation-timeout.spec.ts` | `0dca93097da379d88be169275f3d53cb0bd70ac0b0078d2b4d3b672971942da1` |
| L1-T11 | `tests/L1/T11-steering-patch.spec.ts` | `427394de0e7cb154dea925a23bd4f80e7e60403fd9ca4bd01ed5c8ccdf170c6c` |
| L1-T12a | `tests/L1/T12a-hook-policy.spec.ts` | `7781ab0b9582e795386da89464d6a15f423c1097605ca5ee84c7d71797bd9501` |
| L1-T12b | `tests/L1/T12b-hook-evolution.spec.ts` | `855944a74159661cb3ec6d6552dedfe2ea420bb493b7cbe82a7f740dcdb24d4f` |
| L1-T13 | `tests/L1/T13-hitl-policy.spec.ts` | `4051888f8d06a0b9cac93224f3e60465ef85cde6d814653b35306870a7df4cda` |
| L1-T14 | `tests/L1/T14-delegation-substrate.spec.ts` | `d800ff9803d52b8af76a2c63e62b40d705715e8cc3e6e40c63c6d76525f4ab88` |
| L1-T15 | `tests/L1/T15-context-mode.spec.ts` | `7f104ee6b6e94ad3bc607de9c0807a0c201f09b821549fa01f058fb8c16b85d0` |
| L1-T16 | `tests/L1/T16-reducer-partition.spec.ts` | `d4a88fe5d50597561c37f02e626fd5d8006adf529c1b761bc3e839faf447e40d` |
| L1-T17 | `tests/L1/T17-handoff-schema.spec.ts` | `c03e2e32f77db4bcef89824abed31ec7201909c89fe3cd71c11d2fd93630c546` |
| L1-T18 | `tests/L1/T18-steering-policy.spec.ts` | `e000855363ad8cf9e434200798466cd6b65ef991da4c0e1654a3052669696aa1` |
| L1-T19 | `tests/L1/T19-failure-recovery.spec.ts` | `bc2ef59dcf99fd88c83eb1f45b4faa565f338b8637cc8f2d2de0b448c8b6c287` |
| L1-T20 | `tests/L1/T20-aggregation-router.spec.ts` | `d340e9582041c8b843f64b9ea28dc68e9f1f719df65f8de06729fcdeaf25483e` |
| L1-T21 | `tests/L1/T21-resource-ranker.spec.ts` | `d41cb96228b62e285d79225d7f84376abfe97c60c8f87eefd2070948a61e60a2` |

### 2.5 — L2 spec（`tests/L2/`，18 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L2-T01 | `tests/L2/T01.spec.ts` | `02e6ce9ea425e9af30479346a0ece3bcad438d29f85981f20b69ce32091fd27a` |
| L2-T02 | `tests/L2/T02.spec.ts` | `3a7b5390880ed74c6a47af579df5898b8344508abb5b34c85e517dbd68d58f9c` |
| L2-T03a | `tests/L2/T03a.spec.ts` | `02a4bad8257fe64bc8dfc6ef8d4b48c9acbea6f6d2ee73c64fbc1901a975ed35` |
| L2-T03b | `tests/L2/T03b.spec.ts` | `73c0559f8191ba8c0ab34506f2754936a731587680b72be5300e7df65ce22c48` |
| L2-T04a | `tests/L2/T04a.spec.ts` | `6622a0d1e8b2a2cbb4a84410d3c8c21068ae94af92cb6778d2dc1a650ad6b24c` |
| L2-T04b | `tests/L2/T04b.spec.ts` | `ac43d4e2a00577e77eed13d2651fd6adc017f54385ff6f522c89b2b16a94355a` |
| L2-T05 | `tests/L2/T05.spec.ts` | `84b74ea979b3c85652ba96d6e77bd8853b87403e73cf1d78ece01ea34aaea783` |
| L2-T06 | `tests/L2/T06.spec.ts` | `2bbf003251ff4cfed87a702a767084e7b6ca2cb0e73da2c55e83167741614fc1` |
| L2-T07 | `tests/L2/T07.spec.ts` | `21d49d9ea771b96460b083833c4c472c3b23bf43e857e7821ec390f0c2c974bf` |
| L2-T08 | `tests/L2/T08.spec.ts` | `7ee096b1db9c401e52318b3768468aff6d2792d1fee385dfd8d4d4f826846800` |
| L2-T09a | `tests/L2/T09a.spec.ts` | `e762a711067010629d4b7d458d9e3c7a772832a7ce5bedad7777eac5f982e99b` |
| L2-T09b | `tests/L2/T09b.spec.ts` | `0e9fa972aae8c1b25f03dbfacff223d5800bf9998de8dab9766f8706b0ecc39f` |
| L2-T10 | `tests/L2/T10.spec.ts` | `6b44033c7738b78ef6a4cdee5a1a4bb5e7a491ff9b88b90df918e4f46edf7d7d` |
| L2-T11 | `tests/L2/T11.spec.ts` | `4ba795d2368220bd042275d1963ce15090fcb38cc386c883a01bbdd10753bd36` |
| L2-T12 | `tests/L2/T12.spec.ts` | `17d4caaef68accd9e2d1ee9a1a9f3a1295e713fff157fcc325f4e7768fe0a545` |
| L2-T13 | `tests/L2/T13.spec.ts` | `e2bd8723f7262478ce6b702aa965b89fccb93349917fec946aaf2dbed61d228c` |
| L2-T14 | `tests/L2/T14.spec.ts` | `cfa99dc23c59f7e6391e750eceac408bcb390b9def1f177c3d2e94df6b000cc6` |
| L2-T15 | `tests/L2/T15.spec.ts` | `e1d2902ea51cc95e2873dc3b342e1723810e3bbcc3ddc1cef1f959005c271130` |

### 2.6 — L3 spec（`tests/L3/`，17 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| L3-T01 | `tests/L3/T01-router.spec.ts` | `b7be4de4eaad87905a4ad38f90f1d1edc6d839439525a20ee42ff31b58c31ace` |
| L3-T02 | `tests/L3/T02-beam-search.spec.ts` | `7e7c0152273a32871e29b7356c32b738b2db04603318b3fb036c789ebb4b0be3` |
| L3-T03 | `tests/L3/T03-reflective-mutation.spec.ts` | `93a7b318eaa126158c37619418f1fc2b50a043de5ee849094818e97a2c222f11` |
| L3-T04 | `tests/L3/T04-strict-improvement.spec.ts` | `60cfa0a32117d7ca91ac1bc75e00663c2e25ef2b9f5e3d51252375e6e4fb70ac` |
| L3-T05 | `tests/L3/T05-pareto-selector.spec.ts` | `b0a5a7930414237087ac5e0d50562749d05d873dd7fb8076244f4be0ef90664e` |
| L3-T06a | `tests/L3/T06a-tree-archive.spec.ts` | `9438f4614900c61bc019dd8ab437f1435fc25c15600d81ced784c3b0bdd18626` |
| L3-T06b | `tests/L3/T06b-island-mapelites.spec.ts` | `fe03553c87a2a778da26744a935d779551ec145dfa892e8f12cc7f8237f51f8b` |
| L3-T07 | `tests/L3/T07-expel-counter.spec.ts` | `df98181b07b01805c51631b0f2388ceb8471d612de6d7161f0ace1704c876785` |
| L3-T08 | `tests/L3/T08-commit-on-success.spec.ts` | `15a6b4b840d428269f3e7e5369457abe2258f6496b73b9a63d240ea7298189db` |
| L3-T09 | `tests/L3/T09-evolve-skill-adapter.spec.ts` | `9a440cbba5785c992523b81a63e29f246257a420f918f9ebf1902d0a496b550b` |
| L3-T10 | `tests/L3/T10-full-population.spec.ts` | `acb3d5a639cd52497345721447408952d283925dd85b731e3c10c210553bd7e5` |
| L3-T11 | `tests/L3/T11-dspy-mipro.spec.ts` | `aa737f10d8e3e595bf989b8323972721c0fa36bb3f46297c6434802bd9440687` |
| L3-T12 | `tests/L3/T12-textgrad.spec.ts` | `c9d036ade02005e91ccb86e12c91067dab3750cfdda9ac7d3ade5550440bbf53` |
| L3-T13 | `tests/L3/T13-adas-meta-search.spec.ts` | `2b213087d276faa41131a91bf4e24b14ad6ba8348c8c8b8560a43911a9e51777` |
| L3-T14 | `tests/L3/T14-aflow-mcts.spec.ts` | `f8add3dfc6621d24dbfeca347350d640463800b8f3842b0da33024bfaf00726d` |
| L3-T15 | `tests/L3/T15-weight-channel-off.spec.ts` | `de183878e406195be8c7eeca5240a695ee5bf86645c04fa66eed471bcf369d73` |
| L3-INT | `tests/L3/integration.spec.ts` | `c79edbaf176c10c54ffed500efcfd4a8ed4cd6e58768bb977e11d747fae9f2d2` |

### 2.7 — CE spec（`tests/CE/`，14 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| CE-T01a | `tests/CE/CE-T01a.spec.ts` | `567c736350aa2c6a4c0f33a355f29a73060288edc2751596e6dc97c3cb6b73c6` |
| CE-T01b | `tests/CE/CE-T01b.spec.ts` | `8d85c16a5fb5c7f9d4fcfac23b5a764fa28d339e41f3305cc5e386880501e2dc` |
| CE-T01c | `tests/CE/CE-T01c.spec.ts` | `98ce3710ab2066ab6af8ad6a9889bc970d91b93aa33ec025187656f59b00b5f2` |
| CE-T02 | `tests/CE/CE-T02.spec.ts` | `2629040e64d1496b4ab0bb1afd4a4574b058a1e9829a014cf9aef55f7a626c0f` |
| CE-T03 | `tests/CE/CE-T03.spec.ts` | `72f0e27edc2658e71ece1ac1258040e8b7a4afabaa509ae091868cd3d0a93f10` |
| CE-T04 | `tests/CE/CE-T04.spec.ts` | `6e67414777fb0b0502ecc945b787d3b9f14eb1d393ddf4fc3ff08ed5df9b8c4f` |
| CE-T05 | `tests/CE/CE-T05.spec.ts` | `133aca953e340d43d00c3794a3f8fc727a4b776284ced816d0b8add31ec08aaf` |
| CE-T06 | `tests/CE/CE-T06.spec.ts` | `55f1e87210a7ef64d30633d8e61319fd3ae81e6094728033c600a309ff6cbf0d` |
| CE-T07 | `tests/CE/CE-T07.spec.ts` | `b06c5c17870b6df2a6e5260aa89db714bf26980d64e968aaf0ad3bbae1745652` |
| CE-T08 | `tests/CE/CE-T08.spec.ts` | `eb7fd7886c18b3dac09173e4b83036daba7c0461f07cf1002e0e37e5c142e912` |
| CE-T09 | `tests/CE/CE-T09.spec.ts` | `3acf7c46a581c09bf5e551505b596f6d8e23fb155f82debedb6f0fd3ab61cd19` |
| CE-T10 | `tests/CE/CE-T10.spec.ts` | `c15bc24291b3b352db93589fa668698efa0a84370117e4f78bef692a9f7a7334` |
| CE-T11 | `tests/CE/CE-T11.spec.ts` | `e2cc4d225857d077c3799eee61c2153ba491f23f94498848eb9dbe76f18e7467` |
| CE-T12 | `tests/CE/CE-T12.spec.ts` | `1ed1b98e6e49cd7bbe15d77ee5731720d1f43e0760834721b42340059a4ab28a` |

### 2.8 — XM 跨模块 spec（`tests/XM/`，1 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| XM-T01 | `tests/XM/T01-e2e-evolution-loop.spec.ts` | `1ff1832982d940ffd73753e2b82986f1770881713c50a4bf17e464d52f53cd22` |

### 2.9 — gates smoke（`tests/gates/`，1 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| G1 | `tests/gates/g1-smoke.spec.ts` | `95b43f029753c854503858911c66b565c0186962494bd4337c2c614f10714cd1` |

### 2.10 — CLN cleanup spec（`tests/cleanup/`，3 文件）

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| CLN-T01 | `tests/cleanup/T01-typebox-migration.spec.ts` | `cafce786d781e5dded8239bb76497beeda3121877d1f4145f4b6bd8bb80ec7a7` |
| CLN-T02 | `tests/cleanup/T02-mutation-gate.spec.ts` | `76367339fd5161f431b1581c675caf84095d420962780464e6f4b4d044b07220` |
| CLN-T03 | `tests/cleanup/T03-linux-ci-nonroot.spec.ts` | `9ed5b197ef5c617ffd97328bc7325b33ce00fb3c9d8f376d7eca47d17d72f8c5` |

### 2.11 — adapt 模块 spec（`tests/adapt/` + 跨目录，9 文件）

> Wave 3 adapt 模块（HarnessPort 适配器契约 + 真实进化接线 + 运维安全）出题。
> 由隔离 test-author 仅依 spec（`execution/adapt/TASKS.md`）预生成并锁定。
> RED 态：`@harness/adapters` 包未实现 / `RealLLMPort` 未导出 / `crossCheckEperm`·`filterForgedEperm` 未导出 / `scripts/metrics.mjs`·`scripts/run-suite-5x.mjs` 未落地 → import 失败 = 合法 RED（19 测试全失败，0 通过）。
> ADP-T02/REAL-T01 真实 pi 往返 smoke 用 `it.skipIf(!hasPi)` 环境门控（检测 `command -v pi`）；mock 子进程测试为主体。
>
> **ADP-T02 hash 重锁（testlock:verify 裁决）**：spec §ADP-T02 RED 原写 `vi.mock('node:child_process')`，但 vitest 对内建模块 mock 不生效（`Cannot redefine property: spawn`，built-in 不经 vitest loader，mock factory 永不装配）。test-author 改用**真实 fake pi 二进制**（`fixtures/helpers.ts` 的 `makeFakePiBin`：带 shebang 的 temp `.mjs`，由 `PiHeadlessLLM` 真实 execve spawn，记录 argv/spawn 计数/SIGTERM marker）覆盖同一批行为（spawn argv 断言、非零 exit 重试计数、超时 kill）。此改动比 mock 更真实地覆盖子进程语义，断言更强（`spawnCount().toBe(3)`/`.toBe(1)`、`toBeInstanceOf(PiHeadlessError/PiHeadlessTimeout)`、SIGTERM marker 验证），无 `.skip/.todo` 蒙混。`tests/adapt/fixtures/helpers.ts` + `tests/adapt/T02-pi-adapter.spec.ts` 两文件同步重锁 sha256。
> 报告类任务（ADP-T04/REAL-T02/REAL-T03/OPS-T01）不出单测，验收走 Form B（bash grep 要素）；OPS-T03 主体为 report + 配置类，但其 `scripts/run-suite-5x.mjs` flake diff 逻辑有可测部分，出 fixture 驱动单测（`--diff` 离线模式钉 pass/fail 矩阵 + flake 识别）。

| 任务 | 测试文件 | sha256 |
| --- | --- | --- |
| ADP-T01 | `tests/adapt/fixtures/helpers.ts` | `0b8e8ec3f61547712f37a1f3d66fb18d3c6b7c2ec3337809971b210d3fbfd9d9` |
| ADP-T01 | `tests/adapt/reference-adapter.spec.ts` | `4b085128e68756b265665b09367da380812c2fe3a14c8b69521c7d8b9557b95e` |
| ADP-T02 | `tests/adapt/T02-pi-adapter.spec.ts` | `3153aa6b853d385a1f184a96f0295184170a6188668dbba5a8f3944fac71f2ee` |
| ADP-T02 | `tests/adapt/T02-pi-smoke.spec.ts` | `da19166505ead811ec86949fde9ff912a843f89fb8c451a730de9b3d12c3011d` |
| ADP-T03 | `tests/adapt/T03-claude-code-adapter.spec.ts` | `e8199f0da5427e02ed642199b30224c007778094db8e353c741f97b9539d816c` |
| REAL-T01 | `tests/L3/real-llm.spec.ts` | `679ce193050510f2e0dffc064aa4f559b2fd5c7bf39d43d4e055c8c43a28a5e9` |
| SEC-T01 | `tests/CE/SEC-T01-eperm-cross-check.spec.ts` | `b737eba818da91ee2f47695286d2e572994025154e40e8dfa7a64bbebfed6fa0` |
| OPS-T02 | `tests/ops/metrics.spec.ts` | `608bdb56214318b4e8c8563c0ce73364d7b39a89c949bcbf47fe9914fe141ae1` |
| OPS-T03 | `tests/adapt/OPS-T03-flaky-locator.spec.ts` | `632d747ee014a4f849a47127b5c48491166ce70c38874451a7a3085f715b9bcd` |

### 2.12 锁定合计

| 波次 | 模块 | 文件数 | 测试数 |
| --- | --- | --- | --- |
| Wave 0 | L0C | 14 | 233 |
| Wave 1 | L0S | 52 | 86 |
| Wave 1 | TL | 12 | 72 |
| Wave 2 | L1 | 24 | 131 |
| Wave 2 | L2 | 18 | 119 |
| Wave 2 | L3 | 17 | 107 |
| Wave 2 | CE | 14 | 44 |
| Wave 2 | XM | 1 | 0（parse error：import 目标未落地） |
| Wave 1 | gates | 1 | 3 |
| Wave 2 | CLN | 3 | —（CLN RED 形态，helper/bwrap 未落地） |
| Wave 3 | adapt | 9 | 55 |
| **合计** | | **165** | **850+** |

> RED 门基线（`pnpm vitest run`，详见 `TEST-BASELINE.md`）：已实现 18 任务（L0C T01–T08/T10/T11 + L0S T01/T02/T03/T06 + TL T01/T02/T05/T06）+ G1 smoke 全绿；Wave 2 未实现模块测试全 RED（`Cannot find module @harness/*` / `X is not a function`）。终审实测：276 passed / 519 failed / 795 total，1 文件级 parse error（`tests/XM/T01-e2e-evolution-loop.spec.ts`：`Failed to load url ../../scripts/xm/g5-report.ts`）。
>
> Wave 3 adapt 模块 RED 门：`tests/adapt/`（8 spec + 1 fixture）+ `tests/L3/real-llm.spec.ts` + `tests/CE/SEC-T01-eperm-cross-check.spec.ts` + `tests/ops/metrics.spec.ts` 共 9 文件 / 55 测试用例，全 RED（19 collected-failed + 4 adapt 文件 import-errored；`@harness/adapters` 包未实现 / `RealLLMPort`·`crossCheckEperm`·`filterForgedEperm` 未导出 / `scripts/metrics.mjs`·`scripts/run-suite-5x.mjs` 未落地）。ADP-T02/REAL-T01 真实 pi 往返 smoke 用 `it.skipIf(!hasPi)` 门控（CI 无 pi 自动跳过不红）。

## 3. 复现命令

```bash
cd <repo根>
# 重算全部锁定 hash（须与本表 §2 一致）
find tests -name '*.spec.ts' | sort \
  | while read f; do shasum -a 256 "$f"; done
# RED 门基线（详见 TEST-BASELINE.md）
pnpm vitest run
```

> 若 §3 重算结果与本表 §2 任一行不一致 → 测试文件被改动 → 触发 `test-lock-violation`，按 §1.2 唯一通道处理（test-author 申诉 → 修订 → 重锁 → 重跑 RED 门）。
