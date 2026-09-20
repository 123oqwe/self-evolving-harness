#!/usr/bin/env bash
# CE-T01c · ABC 全量审计门薄壳（spec §CE-T01c 验收#2）。
#
# Spec contract (execution/canary-eval/TASKS.md §CE-T01c 验收):
#   "bash scripts/abc-audit.sh    # 全量 ABC 审计，exit 0=PASS/BUDGET_REPORTED，非0=FAIL"
#
# 调用 scripts/ce-t01c-abc-audit-gate.mjs 对真实 canary/manifest.yaml 跑 runABCAudit。
# coverage 由 $CE_ABC_COVERAGE 注入（G0 降级，缺省 0 → BUDGET_REPORTED，合法 exit 0）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node --experimental-strip-types --no-warnings "$SCRIPT_DIR/ce-t01c-abc-audit-gate.mjs"
