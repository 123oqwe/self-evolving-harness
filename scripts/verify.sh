#!/usr/bin/env bash
# Behavior-gate dispatcher (WBS Appendix A).
#
#   bash scripts/verify.sh <TASK-ID>   → exit 0 (pass) / non-zero (fail)
#
# Routes a TASK-ID to its verify routine via scripts/lib/dispatch.sh.
# L0C-T01 branch is a scaffold placeholder (see lib/dispatch.sh for rationale).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── TEST-LOCK §1.2 sha256 gate (code-level enforcement) ───────────────────────
# Contract: "implementer 领单时由 verify.sh 或 test-lock 门重新计算 sha256 并
# 与本表比对——hash 不变 = 锁定完好。" Prior to this gate the lock was a social
# contract only; in autonomous impl mode an implementer could silently edit
# locked tests and verify.sh would still exit 0. Run the check at entry so any
# task领单 immediately fails on a tampered/missing/extra test file.
#
# Skipped via TEST_LOCK_SKIP=1 only for internal sub-routines that must not
# recurse (none currently); do NOT export this to bypass the lock.
if [[ "${TEST_LOCK_SKIP:-0}" != "1" ]]; then
  node "$SCRIPT_DIR/lib/test-lock-check.mjs" --quiet || {
    echo "verify.sh: TEST-LOCK §1.2 sha256 gate FAILED — refusing to dispatch $*" >&2
    exit 1
  }
fi

# shellcheck source=lib/dispatch.sh
. "$SCRIPT_DIR/lib/dispatch.sh"

dispatch_task "$@"
