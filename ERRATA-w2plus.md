# ERRATA-w2plus

后续波次裁决记录（承接 ERRATA-w01）。每条裁决含：来源 erratum、裁决、落实任务/位置。

---

## SEC-T01 落实 L0S-R2

- **来源 erratum**：ERRATA-w01 §L0S-R2。
- **裁决原文**：用户可控 stderr 伪造 'Operation not permitted' 行仍可进 epermHits
  （证据非证明，固有 surfacing 语义）——CE 消费 epermHits 时须交叉验证 exitCode。
- **落实任务**：SEC-T01（`execution/adapt/TASKS.md` §SEC-T01）。
- **落实位置**：
  - `packages/canary-eval/src/eperm-cross-check.ts`：`crossCheckEperm`（纯函数裁决）
    + `filterForgedEperm`（证据级丢弃 + 审计 warnings）。
  - `packages/canary-eval/src/fresh-evidence-gate.ts`：`assertFreshEvidence` 入口接线
    `filterForgedEperm`（单一职责，单一入口；别处不重复过滤）。
  - `packages/canary-eval/src/index.ts`：导出 `crossCheckEperm`/`filterForgedEperm`/
    `EpermCrossCheckResult` 供后续 L0S/CE 其他 epermHits 消费点复用。
- **裁决规则**：
  - `epermHits=[]`（或 undefined）→ `consistent`（无 EPERM 信号，无需交叉验证）。
  - `epermHits` 非空 + `exitCode!==0` → `consistent`（EPERM 导致非零 exit，自洽）。
  - `epermHits` 非空 + `exitCode===0` → `forged-suspect`（成功 exit 但报 EPERM = 伪造面），
    `dropped=true`，证据从 fresh-evidence 门丢弃。
- **验证**：`pnpm vitest run tests/CE/SEC-T01-eperm-cross-check.spec.ts`（7 用例全绿）+
  `bash scripts/verify.sh SEC-T01`。
