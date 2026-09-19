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
    *)
      echo "verify.sh: unknown TASK-ID '${task_id}'" >&2
      return 1
      ;;
  esac
}
