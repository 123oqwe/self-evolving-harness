#!/usr/bin/env bash
# Shared TASK-ID dispatch table for scripts/verify.sh (WBS Appendix A).
#
# Each registered TASK-ID maps to a verify routine. Exit 0 = pass;
# non-zero = fail. Unknown IDs exit 1. Extracted to scripts/lib/dispatch.sh
# (L0C-T01 REFACTOR step) so subsequent tasks can append branches here
# without touching the verify.sh entrypoint.
#
# Coverage scope (WBS Appendix A.4): ALL 120 task IDs — 117 main-plan
# (L0C/L0S/CE/L3/L1/L2/TL/XM, MVP+V1+V2) + 3 CLN cleanup tasks
# (§3.9, ERRATA-w01 悬空项转正). Implemented branches run their real
# verify routine; NOT-yet-implemented branches map to their canonical
# `pnpm vitest run <test-path>` Form A command. Those run RED by design
# (the locked spec either does not exist yet or its module is unimplemented)
# — dispatch-table completeness takes priority over per-branch greenness.
# integ:lead switches a branch from placeholder-Form-A to its real
# Form B routine when the corresponding task is implemented.
#
# Usage (sourced by verify.sh):
#   dispatch_task "<TASK-ID>"

set -euo pipefail

dispatch_task() {
  local task_id="${1:-}"

  if [[ -z "$task_id" ]]; then
    echo "usage: verify.sh <TASK-ID>" >&2
    return 2
  fi

  case "$task_id" in
    # ── L0C (14) ───────────────────────────────────────────────
    L0C-T01)
      # Scaffold placeholder. The T01 spec's own acceptance test calls
      # `bash scripts/verify.sh L0C-T01` and asserts exit 0; dispatching to
      # the T01 spec itself would recurse infinitely. The Form A spec
      # dispatch form (pnpm vitest run tests/L0C/T01-scaffold.spec.ts) is
      # switched on by integ:lead after T01 completes — not here.
      return 0
      ;;
    L0C-T02)
      # Form A: the locked spec must pass.
      pnpm vitest run tests/L0C/T02-turn.spec.ts || return 1
      # Form B (CLN-T02, ERRATA §BC-3): orphan-tool_result mutation gate on a
      # tmp copy of the locked spec — inject → tmp fails (invariant catches
      # orphan) → restore → original passes → sha256 lock intact. Implemented
      # in scripts/lib/mutate-invariant.sh (replaces the prior pure Form A).
      bash "$SCRIPT_DIR/lib/mutate-invariant.sh" L0C-T02-orphan || return 1
      return 0
      ;;
    L0C-T03)
      # NOT-yet-implemented (Wave 1). Form A canonical path → RED until
      # L0C-T03 lands. CLN-T01 will migrate this schema to real typebox.
      pnpm vitest run tests/L0C/T03-stop.spec.ts || return 1
      return 0
      ;;
    L0C-T04)
      # Form A: the locked spec must pass.
      pnpm vitest run tests/L0C/T04-retry-overflow.spec.ts || return 1
      return 0
      ;;
    L0C-T05)
      # NOT-yet-implemented (Wave 1). Form A canonical path → RED.
      pnpm vitest run tests/L0C/T05-cache-compaction.spec.ts || return 1
      return 0
      ;;
    L0C-T06)
      # Form A: the locked spec must pass.
      pnpm vitest run tests/L0C/T06-memory-schema.spec.ts || return 1
      return 0
      ;;
    L0C-T07a)
      # Form A: the locked spec must pass. The spec additionally asserts the
      # resume duplicate-side-effect hard constraint (terminal tool calls are
      # never re-executed on resume → execution-count delta == 0), which is
      # covered by the `assertNoResentToolCalls` cases inside the spec.
      pnpm vitest run tests/L0C/T07a-runstate.spec.ts || return 1
      return 0
      ;;
    L0C-T07b)
      # Form A: the locked spec must pass (SessionLog append-only + wake
      # rehydration + WriteDeltaJournal completion-order replay).
      pnpm vitest run tests/L0C/T07b-session-log.spec.ts || return 1
      return 0
      ;;
    L0C-T08)
      # Form A: the locked pre-commit guard spec must pass (five dangerous-diff
      # kinds via checkDiff + STATIC_CORE_FIELD_REGISTRY + installPreCommitHook).
      pnpm vitest run tests/L0C/T08-precommit.spec.ts || return 1
      # Form B / spec verify-block gate: construct a temporary git repo, stage
      # each of the five dangerous-diff kinds plus one clean diff, run the
      # staged-diff interceptor (scripts/l0c-t08-check-staged.mjs -> checkDiff)
      # against the REAL staged `git diff --cached`, and assert every dangerous
      # kind rejects (exit 1) while the clean diff is allowed (exit 0).
      node --experimental-strip-types --no-warnings \
        "$SCRIPT_DIR/l0c-t08-verify-gate.mjs" || return 1
      return 0
      ;;
    L0C-T09a)
      # Form B behavior gate (spec §L0C-T09a + ERRATA-w2plus L0C-03).
      # Two invariants; for each: inject mutation → run the locked spec →
      # assert it FAILS (exit≠0, the mutation must be caught); restore →
      # run again → assert it PASSES (exit=0, baseline intact). The locked
      # spec lives at tests/L0C/invariants-A.spec.ts (T02-backed, GREEN by
      # design); the RED-via-mutation is delegated to
      # scripts/mutate-invariant.sh, NOT inlined into the spec file.
      local spec_09a="tests/L0C/invariants-A.spec.ts"
      for inv_09a in L0C-T09a-turn-boundary L0C-T09a-orphan-400; do
        # inject the destructive mutation (saves a .mutate-bak first)
        bash "$SCRIPT_DIR/mutate-invariant.sh" "$inv_09a" || return 1
        # mutated spec MUST fail — if it passes, the mutation is a false-green
        if pnpm vitest run "$spec_09a" >/dev/null 2>&1; then
          bash "$SCRIPT_DIR/mutate-invariant.sh" --restore "$inv_09a" >/dev/null 2>&1 || true
          echo "L0C-T09a: mutation $inv_09a did NOT fail the spec (false-green)" >&2
          return 1
        fi
        # restore the original source from the backup
        bash "$SCRIPT_DIR/mutate-invariant.sh" --restore "$inv_09a" || return 1
        # restored baseline MUST pass — if it fails, restore leaked the mutation
        if ! pnpm vitest run "$spec_09a" >/dev/null 2>&1; then
          echo "L0C-T09a: spec failed after restoring $inv_09a (baseline not intact)" >&2
          return 1
        fi
      done
      return 0
      ;;
    L0C-T09b)
      # NOT-yet-implemented (Wave 5). Same pattern as L0C-T09a.
      pnpm vitest run tests/L0C/T09b-invariants.spec.ts || return 1
      return 0
      ;;
    L0C-T10)
      # NOT-yet-implemented (Wave 5). Form A canonical path → RED.
      pnpm vitest run tests/L0C/T10-breaker.spec.ts || return 1
      return 0
      ;;
    L0C-T11)
      # Form A (ERRATA §5: unified to Appendix A.3 no-`--filter` form,
      # cwd = repo root): the locked read-only enforcement spec must pass.
      pnpm vitest run tests/L0C/T11-readonly.spec.ts || return 1
      return 0
      ;;
    L0C-T12)
      # NOT-yet-implemented (Wave 5). WBS A.3 plans Form A + redteam
      # zero-success behavior assert; until landed, canonical path → RED.
      pnpm vitest run tests/L0C/redteam.spec.ts || return 1
      return 0
      ;;
    L0C-ALL)
      for t in L0C-T01 L0C-T02 L0C-T03 L0C-T04 L0C-T05 L0C-T06 L0C-T07a L0C-T07b \
               L0C-T08 L0C-T09a L0C-T09b L0C-T10 L0C-T11 L0C-T12; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    L0C-INTEGRATION)
      pnpm vitest run tests/L0C/integration.spec.ts || return 1
      return 0
      ;;

    # ── L0S (15) ───────────────────────────────────────────────
    L0S-T01)
      pnpm vitest run tests/L0S/T01.brain-no-credential.spec.ts || return 1
      pnpm vitest run tests/L0S/T01.session-log-append-only.spec.ts || return 1
      pnpm vitest run tests/L0S/T01.session-wake-idempotent.spec.ts || return 1
      return 0
      ;;
    L0S-T02)
      pnpm vitest run tests/L0S/T02.sandbox-deny-ssh.spec.ts || return 1
      pnpm vitest run tests/L0S/T02.sandbox-deny-egress.spec.ts || return 1
      pnpm vitest run tests/L0S/T02.sandbox-platform-skip.spec.ts || return 1
      return 0
      ;;
    L0S-T03)
      pnpm vitest run tests/L0S/T03.deny-read-ssh.spec.ts || return 1
      pnpm vitest run tests/L0S/T03.narrower-allow-reopens.spec.ts || return 1
      pnpm vitest run tests/L0S/T03.symlink-bypass-blocked.spec.ts || return 1
      pnpm vitest run tests/L0S/T03.worktree-write-scoped.spec.ts || return 1
      return 0
      ;;
    L0S-T04a)
      pnpm vitest run tests/L0S/T04a.allowlist-subdomain.spec.ts || return 1
      pnpm vitest run tests/L0S/T04a.dns-rebinding-blocked.spec.ts || return 1
      pnpm vitest run tests/L0S/T04a.non-allowlist-denied.spec.ts || return 1
      pnpm vitest run tests/L0S/T04a.proxy-egress-log.spec.ts || return 1
      return 0
      ;;
    L0S-T04b)
      pnpm vitest run tests/L0S/T04b.egress-no-real-secret.spec.ts || return 1
      pnpm vitest run tests/L0S/T04b.env-strip.spec.ts || return 1
      pnpm vitest run tests/L0S/T04b.injectHosts-subset.spec.ts || return 1
      pnpm vitest run tests/L0S/T04b.log-redact.spec.ts || return 1
      pnpm vitest run tests/L0S/T04b.sigv4-resign.spec.ts || return 1
      return 0
      ;;
    L0S-T05)
      pnpm vitest run tests/L0S/T05.exfil-detected.spec.ts || return 1
      pnpm vitest run tests/L0S/T05.injecthost-egress-not-counted.spec.ts || return 1
      pnpm vitest run tests/L0S/T05.no-leak-on-clean-run.spec.ts || return 1
      return 0
      ;;
    L0S-T06)
      pnpm vitest run tests/L0S/T06.concurrency-limit.spec.ts || return 1
      pnpm vitest run tests/L0S/T06.orphan-list.spec.ts || return 1
      pnpm vitest run tests/L0S/T06.teardown-on-throw.spec.ts || return 1
      pnpm vitest run tests/L0S/T06.timeout-kills.spec.ts || return 1
      return 0
      ;;
    L0S-T07)
      pnpm vitest run tests/L0S/T07.monotonic-tighten.spec.ts || return 1
      pnpm vitest run tests/L0S/T07.self-deny-read.spec.ts || return 1
      pnpm vitest run tests/L0S/T07.sha256-verify.spec.ts || return 1
      return 0
      ;;
    L0S-T08)
      pnpm vitest run tests/L0S/T08.allow-relax-needs-signoff.spec.ts || return 1
      pnpm vitest run tests/L0S/T08.allow-with-signoff.spec.ts || return 1
      pnpm vitest run tests/L0S/T08.deny-tighten-auto.spec.ts || return 1
      return 0
      ;;
    L0S-T09)
      pnpm vitest run tests/L0S/T09.breaker-rejects-relaxation.spec.ts || return 1
      pnpm vitest run tests/L0S/T09.debiased-consistency.spec.ts || return 1
      pnpm vitest run tests/L0S/T09.safety-suite-f1.spec.ts || return 1
      return 0
      ;;
    L0S-T10)
      pnpm vitest run tests/L0S/T10.diff-exists.spec.ts || return 1
      pnpm vitest run tests/L0S/T10.never-auto-delete.spec.ts || return 1
      pnpm vitest run tests/L0S/T10.orphan-count-decreases.spec.ts || return 1
      return 0
      ;;
    L0S-T11)
      pnpm vitest run tests/L0S/T11.canary-zero-tolerance.spec.ts || return 1
      pnpm vitest run tests/L0S/T11.injecthost-needs-signoff-and-subset.spec.ts || return 1
      pnpm vitest run tests/L0S/T11.sensitive-env-tighten.spec.ts || return 1
      return 0
      ;;
    L0S-T12)
      pnpm vitest run tests/L0S/T12.contract-unchanged.spec.ts || return 1
      pnpm vitest run tests/L0S/T12.dual-verifier.spec.ts || return 1
      pnpm vitest run tests/L0S/T12.needs-signoff.spec.ts || return 1
      pnpm vitest run tests/L0S/T12.security-degradation-rejected.spec.ts || return 1
      return 0
      ;;
    L0S-T13)
      pnpm vitest run tests/L0S/T13.abc-empty-response.spec.ts || return 1
      pnpm vitest run tests/L0S/T13.canary-payload-sha256.spec.ts || return 1
      pnpm vitest run tests/L0S/T13.monotonic-stricter.spec.ts || return 1
      return 0
      ;;
    L0S-T14)
      pnpm vitest run tests/L0S/T14.etc-passwd-blocked.spec.ts || return 1
      pnpm vitest run tests/L0S/T14.metadata-blocked.spec.ts || return 1
      pnpm vitest run tests/L0S/T14.ssh-read-blocked.spec.ts || return 1
      pnpm vitest run tests/L0S/T14.zero-escape.spec.ts || return 1
      return 0
      ;;
    L0S-ALL)
      for t in L0S-T01 L0S-T02 L0S-T03 L0S-T04a L0S-T04b L0S-T05 L0S-T06 L0S-T07 \
               L0S-T08 L0S-T09 L0S-T10 L0S-T11 L0S-T12 L0S-T13 L0S-T14; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    L0S-INTEGRATION)
      pnpm vitest run tests/L0S/integration.spec.ts || return 1
      return 0
      ;;

    # ── CE (17) ────────────────────────────────────────────────
    CE-T00a) pnpm vitest run tests/CE/CE-T00a.spec.ts || return 1; return 0 ;;
    CE-T00b) pnpm vitest run tests/CE/CE-T00b.spec.ts || return 1; return 0 ;;
    CE-T00c) pnpm vitest run tests/CE/CE-T00c.spec.ts || return 1; return 0 ;;
    CE-T01a)
      pnpm vitest run tests/CE/CE-T01a.spec.ts || return 1
      # WBS A.3 behavior assert (spec §CE-T01a 验收#2):
      # canary/manifest.yaml 存在 → loadCanary tasks>=30 →
      # verifyManifestSha256===true。非合成 fixture，断言真实交付物。
      node --experimental-strip-types --no-warnings \
        "$SCRIPT_DIR/ce-t01a-verify-gate.mjs" || return 1
      return 0
      ;;
    CE-T01b) pnpm vitest run tests/CE/CE-T01b.spec.ts || return 1; return 0 ;;
    CE-T01c) pnpm vitest run tests/CE/CE-T01c.spec.ts || return 1; return 0 ;;
    CE-T02)  pnpm vitest run tests/CE/CE-T02.spec.ts || return 1; return 0 ;;
    CE-T03)  pnpm vitest run tests/CE/CE-T03.spec.ts || return 1; return 0 ;;
    CE-T04)  pnpm vitest run tests/CE/CE-T04.spec.ts || return 1; return 0 ;;
    CE-T05)  pnpm vitest run tests/CE/CE-T05.spec.ts || return 1; return 0 ;;
    CE-T06)  pnpm vitest run tests/CE/CE-T06.spec.ts || return 1; return 0 ;;
    CE-T07)  pnpm vitest run tests/CE/CE-T07.spec.ts || return 1; return 0 ;;
    CE-T08)  pnpm vitest run tests/CE/CE-T08.spec.ts || return 1; return 0 ;;
    CE-T09)  pnpm vitest run tests/CE/CE-T09.spec.ts || return 1; return 0 ;;
    CE-T10)  pnpm vitest run tests/CE/CE-T10.spec.ts || return 1; return 0 ;;
    CE-T11)  pnpm vitest run tests/CE/CE-T11.spec.ts || return 1; return 0 ;;
    CE-T12)
      pnpm vitest run tests/CE/CE-T12.spec.ts || return 1
      # WBS A.3 behavior assert: 投毒 fixture 100% 隔离 (lands with task)
      return 0
      ;;
    CE-ALL)
      for t in CE-T00a CE-T00b CE-T00c CE-T01a CE-T01b CE-T01c CE-T02 CE-T03 \
               CE-T04 CE-T05 CE-T06 CE-T07 CE-T08 CE-T09 CE-T10 CE-T11 CE-T12; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    CE-INTEGRATION)
      pnpm vitest run tests/CE/integration.spec.ts || return 1
      return 0
      ;;

    # ── L3 (16) ────────────────────────────────────────────────
    L3-T01)
      pnpm vitest run tests/L3/T01-router.spec.ts || return 1
      # WBS A.3 behavior assert: 权重通道默认 off + static-core 只读 (lands with task)
      return 0
      ;;
    L3-T02) pnpm vitest run tests/L3/T02-beam-search.spec.ts || return 1; return 0 ;;
    L3-T03) pnpm vitest run tests/L3/T03-reflective-mutation.spec.ts || return 1; return 0 ;;
    L3-T04)
      pnpm vitest run tests/L3/T04-strict-improvement.spec.ts || return 1
      # WBS A.3 behavior assert: 注入退化变体 → reject (lands with task)
      return 0
      ;;
    L3-T05) pnpm vitest run tests/L3/T05-pareto-selector.spec.ts || return 1; return 0 ;;
    L3-T06a) pnpm vitest run tests/L3/T06a-tree-archive.spec.ts || return 1; return 0 ;;
    L3-T06b) pnpm vitest run tests/L3/T06b-island-mapelites.spec.ts || return 1; return 0 ;;
    L3-T07) pnpm vitest run tests/L3/T07-expel-counter.spec.ts || return 1; return 0 ;;
    L3-T08) pnpm vitest run tests/L3/T08-commit-on-success.spec.ts || return 1; return 0 ;;
    L3-T09) pnpm vitest run tests/L3/T09-evolve-skill-adapter.spec.ts || return 1; return 0 ;;
    L3-T10) pnpm vitest run tests/L3/T10-full-population.spec.ts || return 1; return 0 ;;
    L3-T11) pnpm vitest run tests/L3/T11-dspy-mipro.spec.ts || return 1; return 0 ;;
    L3-T12) pnpm vitest run tests/L3/T12-textgrad.spec.ts || return 1; return 0 ;;
    L3-T13) pnpm vitest run tests/L3/T13-adas-meta-search.spec.ts || return 1; return 0 ;;
    L3-T14) pnpm vitest run tests/L3/T14-aflow-mcts.spec.ts || return 1; return 0 ;;
    L3-T15) pnpm vitest run tests/L3/T15-weight-channel-off.spec.ts || return 1; return 0 ;;
    L3-ALL)
      for t in L3-T01 L3-T02 L3-T03 L3-T04 L3-T05 L3-T06a L3-T06b L3-T07 L3-T08 \
               L3-T09 L3-T10 L3-T11 L3-T12 L3-T13 L3-T14 L3-T15; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    L3-INTEGRATION)
      pnpm vitest run tests/L3/integration.spec.ts || return 1
      return 0
      ;;

    # ── L1 (24) ────────────────────────────────────────────────
    L1-T01)  pnpm vitest run tests/L1/T01-repo-layout.spec.ts || return 1; return 0 ;;
    L1-T02)  pnpm vitest run tests/L1/T02-compaction-substrate.spec.ts || return 1; return 0 ;;
    L1-T03)  pnpm vitest run tests/L1/T03-signature-phase.spec.ts || return 1; return 0 ;;
    L1-T04a) pnpm vitest run tests/L1/T04a-evolution-driver.spec.ts || return 1; return 0 ;;
    L1-T04b) pnpm vitest run tests/L1/T04b-select-retain.spec.ts || return 1; return 0 ;;
    L1-T05a) pnpm vitest run tests/L1/T05a-phase-evolution-driver.spec.ts || return 1; return 0 ;;
    L1-T05b) pnpm vitest run tests/L1/T05b-phase-select-retain.spec.ts || return 1; return 0 ;;
    L1-T06)  pnpm vitest run tests/L1/T06-tool-registry.spec.ts || return 1; return 0 ;;
    L1-T07)  pnpm vitest run tests/L1/T07-tool-evolution.spec.ts || return 1; return 0 ;;
    L1-T08)  pnpm vitest run tests/L1/T08-tool-subset-defer.spec.ts || return 1; return 0 ;;
    L1-T09)  pnpm vitest run tests/L1/T09-history-processors.spec.ts || return 1; return 0 ;;
    L1-T10)  pnpm vitest run tests/L1/T10-truncation-timeout.spec.ts || return 1; return 0 ;;
    L1-T11)  pnpm vitest run tests/L1/T11-steering-patch.spec.ts || return 1; return 0 ;;
    L1-T12a) pnpm vitest run tests/L1/T12a-hook-policy.spec.ts || return 1; return 0 ;;
    L1-T12b) pnpm vitest run tests/L1/T12b-hook-evolution.spec.ts || return 1; return 0 ;;
    L1-T13)  pnpm vitest run tests/L1/T13-hitl-policy.spec.ts || return 1; return 0 ;;
    L1-T14)  pnpm vitest run tests/L1/T14-delegation-substrate.spec.ts || return 1; return 0 ;;
    L1-T15)  pnpm vitest run tests/L1/T15-context-mode.spec.ts || return 1; return 0 ;;
    L1-T16)  pnpm vitest run tests/L1/T16-reducer-partition.spec.ts || return 1; return 0 ;;
    L1-T17)  pnpm vitest run tests/L1/T17-handoff-schema.spec.ts || return 1; return 0 ;;
    L1-T18)  pnpm vitest run tests/L1/T18-steering-policy.spec.ts || return 1; return 0 ;;
    L1-T19)  pnpm vitest run tests/L1/T19-failure-recovery.spec.ts || return 1; return 0 ;;
    L1-T20)  pnpm vitest run tests/L1/T20-aggregation-router.spec.ts || return 1; return 0 ;;
    L1-T21)  pnpm vitest run tests/L1/T21-resource-ranker.spec.ts || return 1; return 0 ;;
    L1-ALL)
      for t in L1-T01 L1-T02 L1-T03 L1-T04a L1-T04b L1-T05a L1-T05b L1-T06 L1-T07 \
               L1-T08 L1-T09 L1-T10 L1-T11 L1-T12a L1-T12b L1-T13 L1-T14 L1-T15 \
               L1-T16 L1-T17 L1-T18 L1-T19 L1-T20 L1-T21; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    L1-INTEGRATION)
      pnpm vitest run tests/L1/e2e.spec.ts || return 1
      return 0
      ;;

    # ── L2 (18) ────────────────────────────────────────────────
    L2-T01)  pnpm vitest run tests/L2/T01.spec.ts || return 1; return 0 ;;
    L2-T02)  pnpm vitest run tests/L2/T02.spec.ts || return 1; return 0 ;;
    L2-T03a) pnpm vitest run tests/L2/T03a.spec.ts || return 1; return 0 ;;
    L2-T03b) pnpm vitest run tests/L2/T03b.spec.ts || return 1; return 0 ;;
    L2-T04a) pnpm vitest run tests/L2/T04a.spec.ts || return 1; return 0 ;;
    L2-T04b) pnpm vitest run tests/L2/T04b.spec.ts || return 1; return 0 ;;
    L2-T05)  pnpm vitest run tests/L2/T05.spec.ts || return 1; return 0 ;;
    L2-T06)  pnpm vitest run tests/L2/T06.spec.ts || return 1; return 0 ;;
    L2-T07)  pnpm vitest run tests/L2/T07.spec.ts || return 1; return 0 ;;
    L2-T08)  pnpm vitest run tests/L2/T08.spec.ts || return 1; return 0 ;;
    L2-T09a) pnpm vitest run tests/L2/T09a.spec.ts || return 1; return 0 ;;
    L2-T09b) pnpm vitest run tests/L2/T09b.spec.ts || return 1; return 0 ;;
    L2-T10)  pnpm vitest run tests/L2/T10.spec.ts || return 1; return 0 ;;
    L2-T11)  pnpm vitest run tests/L2/T11.spec.ts || return 1; return 0 ;;
    L2-T12)  pnpm vitest run tests/L2/T12.spec.ts || return 1; return 0 ;;
    L2-T13)  pnpm vitest run tests/L2/T13.spec.ts || return 1; return 0 ;;
    L2-T14)  pnpm vitest run tests/L2/T14.spec.ts || return 1; return 0 ;;
    L2-T15)  pnpm vitest run tests/L2/T15.spec.ts || return 1; return 0 ;;
    L2-ALL)
      for t in L2-T01 L2-T02 L2-T03a L2-T03b L2-T04a L2-T04b L2-T05 L2-T06 L2-T07 \
               L2-T08 L2-T09a L2-T09b L2-T10 L2-T11 L2-T12 L2-T13 L2-T14 L2-T15; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    L2-INTEGRATION)
      pnpm vitest run tests/L2/integration.spec.ts || return 1
      return 0
      ;;

    # ── TL (12) ────────────────────────────────────────────────
    TL-T01) pnpm vitest run tests/TL/T01-transcript.spec.ts || return 1; return 0 ;;
    TL-T02) pnpm vitest run tests/TL/T02-usage.spec.ts || return 1; return 0 ;;
    TL-T03) pnpm vitest run tests/TL/T03-otel.spec.ts || return 1; return 0 ;;
    TL-T04) pnpm vitest run tests/TL/T04-replay.spec.ts || return 1; return 0 ;;
    TL-T05) pnpm vitest run tests/TL/T05-schema-policy.spec.ts || return 1; return 0 ;;
    TL-T06)
      pnpm vitest run tests/TL/T06-budget-policy.spec.ts || return 1
      # WBS A.3 behavior assert: 11 次连续 bash → runaway (lands with task)
      return 0
      ;;
    TL-T07)
      pnpm vitest run tests/TL/T07-capture-policy.spec.ts || return 1
      # WBS A.3 behavior assert: PII 未脱敏 → PIILeakError (lands with task)
      return 0
      ;;
    TL-T08) pnpm vitest run tests/TL/T08-clustering.spec.ts || return 1; return 0 ;;
    TL-T09) pnpm vitest run tests/TL/T09-distill-selector.spec.ts || return 1; return 0 ;;
    TL-T10) pnpm vitest run tests/TL/T10-flywheel.spec.ts || return 1; return 0 ;;
    TL-T11) pnpm vitest run tests/TL/T11-insight.spec.ts || return 1; return 0 ;;
    TL-T12) pnpm vitest run tests/TL/T12-otlp-backend.spec.ts || return 1; return 0 ;;
    TL-ALL)
      for t in TL-T01 TL-T02 TL-T03 TL-T04 TL-T05 TL-T06 TL-T07 TL-T08 TL-T09 \
               TL-T10 TL-T11 TL-T12; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;
    TL-INTEGRATION)
      pnpm vitest run tests/TL/integration/tl-e2e.spec.ts || return 1
      return 0
      ;;

    # ── XM (1) ─────────────────────────────────────────────────
    XM-T01)
      pnpm vitest run tests/XM/T01-e2e-evolution-loop.spec.ts || return 1
      # Form B behavior assert: 端到端 + 回滚演练 + G5 报告生成 (lands with task)
      return 0
      ;;
    XM-ALL)
      dispatch_task XM-T01 || { echo "FAIL XM-T01"; return 1; }
      return 0
      ;;

    # ── CLN (3) — 清理任务（§3.9, ERRATA-w01 悬空项转正） ──────
    CLN-T01)
      # Form A: CLN typebox-migration spec + L0C-T03/T06 locked specs still GREEN.
      pnpm vitest run tests/cleanup/T01-typebox-migration.spec.ts || return 1
      pnpm vitest run tests/L0C/T03-stop.spec.ts || return 1
      pnpm vitest run tests/L0C/T06-memory-schema.spec.ts || return 1
      # Form B: build green + grep confirms the two schema files import typebox.
      pnpm -F @harness/l0-core build || return 1
      grep -q "@sinclair/typebox" packages/l0-core/src/stop-schema.ts || return 1
      grep -q "@sinclair/typebox" packages/l0-core/src/memory-schema.ts || return 1
      return 0
      ;;
    CLN-T02)
      # Form A: the CLN mutation-gate spec must pass.
      pnpm vitest run tests/cleanup/T02-mutation-gate.spec.ts || return 1
      # Form B: helper self-check (注入 fail / 恢复 pass) + sha256 lock intact.
      bash "$SCRIPT_DIR/lib/mutate-invariant.sh" L0C-T02-orphan || return 1
      # Regression: L0C-T02 now full Form B (Form A + mutation gate).
      dispatch_task L0C-T02 || return 1
      return 0
      ;;
    CLN-T03)
      # Form A: the CLN non-root CI spec must pass.
      pnpm vitest run tests/cleanup/T03-linux-ci-nonroot.spec.ts || return 1
      # Form B: bwrap argv contains --cap-drop ALL + breaker rejects removal.
      node --experimental-strip-types --no-warnings \
        "$SCRIPT_DIR/cln-t03-bwrap-verify.mjs" || return 1
      return 0
      ;;
    CLN-ALL)
      for t in CLN-T01 CLN-T02 CLN-T03; do
        dispatch_task "$t" || { echo "FAIL $t"; return 1; }; done
      return 0
      ;;

    *)
      echo "verify.sh: unknown TASK-ID '${task_id}'" >&2
      return 1
      ;;
  esac
}
