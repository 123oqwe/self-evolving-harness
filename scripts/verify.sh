#!/usr/bin/env bash
# Behavior-gate dispatcher (WBS Appendix A).
#
#   bash scripts/verify.sh <TASK-ID>   → exit 0 (pass) / non-zero (fail)
#
# Routes a TASK-ID to its verify routine via scripts/lib/dispatch.sh.
# L0C-T01 branch is a scaffold placeholder (see lib/dispatch.sh for rationale).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/dispatch.sh
. "$SCRIPT_DIR/lib/dispatch.sh"

dispatch_task "$@"
