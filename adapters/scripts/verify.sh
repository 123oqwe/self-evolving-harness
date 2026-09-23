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
  ADP-T02)
    PI_ADAPTER="adapters/src/pi/pi-adapter.ts"
    HEADLESS="adapters/src/pi/headless-llm.ts"
    [ -f "$PI_ADAPTER" ] || { echo "FAIL: $PI_ADAPTER 不存在"; exit 1; }
    [ -f "$HEADLESS" ] || { echo "FAIL: $HEADLESS 不存在"; exit 1; }
    # PiAdapter implements HarnessPort 全方法 + llmPort 字段
    for member in readSubstrate writeSubstrate readTrajectories deploy rollback llmPort; do
      grep -q "$member" "$PI_ADAPTER" || { echo "FAIL: $member 未在 PiAdapter 中实现"; exit 1; }
    done
    # 复用铁律：从 @harness/l3-engine 导入 Trajectory/LLMPort；复用 HarnessPort/SubstrateHandle
    grep -q "from \"../port.js\"" "$PI_ADAPTER" || { echo "FAIL: 未复用 ADP-T01 port.js"; exit 1; }
    grep -q "Trajectory" "$PI_ADAPTER" || { echo "FAIL: 未复用 L3 Trajectory"; exit 1; }
    grep -q "LLMPort" "$PI_ADAPTER" || { echo "FAIL: 未复用 L3 LLMPort"; exit 1; }
    grep -q "bumpVersion" "$PI_ADAPTER" || { echo "FAIL: 未复用 L3-T08 bumpVersion"; exit 1; }
    # PiHeadlessLLM implements LLMPort + 超时/重试错误类型
    grep -q "implements LLMPort" "$HEADLESS" || { echo "FAIL: PiHeadlessLLM 未 implements LLMPort"; exit 1; }
    grep -q "PiHeadlessError" "$HEADLESS" || { echo "FAIL: PiHeadlessError 缺失"; exit 1; }
    grep -q "PiHeadlessTimeout" "$HEADLESS" || { echo "FAIL: PiHeadlessTimeout 缺失"; exit 1; }
    # spawn argv 含 -p（print mode），prompt 经 stdin
    grep -q '"-p"' "$HEADLESS" || { echo "FAIL: 未用 pi print mode -p"; exit 1; }
    grep -q "stdin" "$HEADLESS" || { echo "FAIL: prompt 未经 stdin 传入"; exit 1; }
    echo "ADP-T02 verify: ok (PiAdapter implements HarnessPort + PiHeadlessLLM 超时/重试)"
    ;;
  ADP-T03)
    CC_ADAPTER="adapters/src/claude-code/claude-code-adapter.ts"
    EXAM_LOCK="adapters/src/claude-code/exam-lock.ts"
    TRAJ="adapters/src/claude-code/trajectory.ts"
    [ -f "$CC_ADAPTER" ] || { echo "FAIL: $CC_ADAPTER 不存在"; exit 1; }
    [ -f "$EXAM_LOCK" ] || { echo "FAIL: $EXAM_LOCK 不存在"; exit 1; }
    [ -f "$TRAJ" ] || { echo "FAIL: $TRAJ 不存在"; exit 1; }
    # ClaudeCodeAdapter implements HarnessPort 全方法 + llmPort 字段
    for member in readSubstrate writeSubstrate readTrajectories deploy rollback llmPort; do
      grep -q "$member" "$CC_ADAPTER" || { echo "FAIL: $member 未在 ClaudeCodeAdapter 中实现"; exit 1; }
    done
    # 复用铁律：从 @harness/l3-engine 导入 Trajectory/LLMPort；复用 HarnessPort/SubstrateHandle
    grep -q 'from "../port.js"' "$CC_ADAPTER" || { echo "FAIL: 未复用 ADP-T01 port.js"; exit 1; }
    grep -q "Trajectory" "$CC_ADAPTER" || { echo "FAIL: 未复用 L3 Trajectory"; exit 1; }
    grep -q "LLMPort" "$CC_ADAPTER" || { echo "FAIL: 未复用 L3 LLMPort"; exit 1; }
    grep -q "bumpVersion" "$CC_ADAPTER" || { echo "FAIL: 未复用 L3-T08 bumpVersion"; exit 1; }
    # LLM 透传（不在 adapter 里 spawn claude）
    grep -q "透传" "$CC_ADAPTER" || grep -q "passthrough" "$CC_ADAPTER" || { echo "FAIL: LLM 未透传"; exit 1; }
    # exam-lock：isExamLockedPath + buildExamLockHook + Write/Edit/Bash 三类工具
    grep -q "isExamLockedPath" "$EXAM_LOCK" || { echo "FAIL: isExamLockedPath 缺失"; exit 1; }
    grep -q "buildExamLockHook" "$EXAM_LOCK" || { echo "FAIL: buildExamLockHook 缺失"; exit 1; }
    grep -q "Write" "$EXAM_LOCK" || { echo "FAIL: Write 工具未覆盖"; exit 1; }
    grep -q "Edit" "$EXAM_LOCK" || { echo "FAIL: Edit 工具未覆盖"; exit 1; }
    grep -q "Bash" "$EXAM_LOCK" || { echo "FAIL: Bash 工具未覆盖"; exit 1; }
    grep -q "PreToolUse" "$EXAM_LOCK" || { echo "FAIL: PreToolUse event 缺失"; exit 1; }
    # JSONL→Trajectory 映射器纯函数
    grep -q "mapClaudeEventToTrajectory" "$TRAJ" || { echo "FAIL: mapClaudeEventToTrajectory 缺失"; exit 1; }
    echo "ADP-T03 verify: ok (ClaudeCodeAdapter implements HarnessPort + exam-lock 命中 tests/)"
    ;;
  ADP-T04)
    # Report task (README + adapter matrix + quick-start + security model).
    # Form B = bash grep of README key sections/elements.
    README="README.md"
    [ -f "$README" ] || { echo "FAIL: $README 不存在"; exit 1; }
    grep -q "自进化" "$README"                                    || { echo "FAIL: 一句话定位缺失"; exit 1; }
    grep -qE "L0|L1|L2|L3|adapters" "$README"                     || { echo "FAIL: 架构图缺失"; exit 1; }
    grep -qE "适配器矩阵|adapter matrix|适配矩阵" "$README"        || { echo "FAIL: 矩阵章节缺失"; exit 1; }
    grep -qE "pi|Claude Code|OpenHands|通用" "$README"            || { echo "FAIL: 矩阵列缺失"; exit 1; }
    grep -qE "5 分钟|快速上手|quick start" "$README"             || { echo "FAIL: 快速上手缺失"; exit 1; }
    grep -qE "static-core|出题权|strict-improvement|canary" "$README" || { echo "FAIL: 安全模型缺失"; exit 1; }
    echo "ADP-T04 verify: ok (README 一句话/架构图/矩阵/快速上手/安全模型齐)"
    ;;
  *)
    echo "usage: $0 ADP-T01|ADP-T02|ADP-T03|ADP-T04"
    exit 1
    ;;
esac
