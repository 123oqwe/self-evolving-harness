#!/usr/bin/env bash
# ADP-T01 验收脚本：断言 HarnessPort 7 成员（6 方法 + llmPort 字段）在
# ReferenceAdapter 实现中均有覆盖。
#
# 用法: bash adapters/scripts/verify.sh ADP-T01
set -euo pipefail

TASK="${1:-}"
case "$TASK" in
  ADP-T01)
    PORT="adapters/src/port.ts"
    [ -f "$PORT" ] || { echo "FAIL: $PORT 不存在"; exit 1; }
    # 契约 6 方法 + 1 字段
    for member in readSubstrate writeSubstrate readTrajectories deploy rollback llmPort; do
      grep -q "$member" "$PORT" || { echo "FAIL: $member 未在 $PORT 中实现"; exit 1; }
    done
    # 错误类型
    grep -q "SubstrateNotFoundError" "$PORT" || { echo "FAIL: SubstrateNotFoundError 缺失"; exit 1; }
    grep -q "UnknownStagingError" "$PORT" || { echo "FAIL: UnknownStagingError 缺失"; exit 1; }
    # 复用铁律：从 @harness/l3-engine 导入 SubstrateKind/Trajectory/LLMPort/STATIC_CORE_PATHS
    grep -q "STATIC_CORE_PATHS" "$PORT" || { echo "FAIL: 未复用 STATIC_CORE_PATHS"; exit 1; }
    grep -q "bumpVersion" "$PORT" || { echo "FAIL: 未复用 L3-T08 bumpVersion"; exit 1; }
    grep -q "Trajectory" "$PORT" || { echo "FAIL: 未复用 L3 Trajectory"; exit 1; }
    grep -q "LLMPort" "$PORT" || { echo "FAIL: 未复用 L3 LLMPort"; exit 1; }
    echo "ADP-T01 verify: ok (HarnessPort 7 成员 + 复用铁律齐)"
    ;;
  *)
    echo "usage: $0 ADP-T01"
    exit 1
    ;;
esac
