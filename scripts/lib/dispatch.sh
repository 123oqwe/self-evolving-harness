#!/usr/bin/env bash
# Shared TASK-ID dispatch table for scripts/verify.sh (WBS Appendix A).
#
# Each registered TASK-ID maps to a verify routine. Exit 0 = pass;
# non-zero = fail. Unknown IDs exit 1. Extracted to scripts/lib/dispatch.sh
# (L0C-T01 REFACTOR step) so subsequent tasks can append branches here
# without touching the verify.sh entrypoint.
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
      return 0
      ;;
    L0C-T04)
      # Form A: the locked spec must pass.
      pnpm vitest run tests/L0C/T04-retry-overflow.spec.ts || return 1
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
    L0C-T11)
      # Form A (ERRATA §5: unified to Appendix A.3 no-`--filter` form,
      # cwd = repo root): the locked read-only enforcement spec must pass.
      pnpm vitest run tests/L0C/T11-readonly.spec.ts || return 1
      return 0
      ;;
    *)
      echo "verify.sh: unknown TASK-ID '${task_id}'" >&2
      return 1
      ;;
  esac
}
