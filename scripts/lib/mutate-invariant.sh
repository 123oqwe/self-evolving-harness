#!/usr/bin/env bash
# scripts/lib/mutate-invariant.sh — CLN-T02 L0C-T02 Form B 突变门 helper.
#
# Spec: execution/cleanup/TASKS.md §CLN-T02 (ERRATA-w01 §BC-3)
#
# 在隔离 vitest 进程里对锁定 spec 的 *tmp 副本* 注入孤儿 tool_result，
# 期望 tmp 副本 fail（不变量捕获孤儿），恢复后原 spec pass。
# 两步符合预期 = 突变门通过 → exit 0。
#
# 工程障碍收口（ERRATA-w01 §BC-3 "临时 vitest config + repo-root 解析"）：
#   - 临时 vitest config：用 `--config <tmp-config>` 指向一个临时 config，
#     该 config `test.include` 指向被突变 spec 文件的绝对路径，避免污染主
#     vitest.config.ts 的 include glob（主 glob 仅含 tests/**/*.spec.ts，
#     tmp 副本在 /tmp 下不会被主 config 收集）。
#   - repo-root 解析：`git rev-parse --show-toplevel`（fallback 相对路径），
#     所有路径基于 repo root，避免 cwd 漂移导致 tests/L0C/... 解析失败。
#
# 铁律：突变打在 tmp 副本，绝不写回 tests/L0C/T02-turn.spec.ts（写回 =
# test-lock-violation）。helper 用 sha256 自检锁定文件跑前后一致。
#
# Usage:
#   bash scripts/lib/mutate-invariant.sh <variant>            # 跑完整突变门
#   bash scripts/lib/mutate-invariant.sh --restore <variant>  # 清理（幂等 no-op）
#   bash scripts/lib/mutate-invariant.sh --list               # 列出已知 variant
#
# Exit codes:
#   0  突变门通过（注入 fail + 恢复 pass + 锁定未破）
#   1  门失败 / 未知 variant / 突变未 land / 锁定被破坏 / false-green
#   2  usage error
#
# Registered variants:
#   L0C-T02-orphan — 向 scenario-1 transcript 注入孤儿 tool_result
# (后续 L0C-T09a/b 等复用同 helper 时追加 variant 表项。)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── repo-root 解析 (ERRATA-w01 §BC-3) ───────────────────────────────────────
# 优先 git toplevel；git 不可用时 fallback 到相对路径。
if REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
export REPO_ROOT

# ── tmp 副本清理登记（顶层 EXIT trap，确保异常退出也不留污染） ───────────────
_MUTATE_TMP_DIRS=()
_cleanup_all() {
  local d
  # ${arr[@]+...} 守卫：数组为空时（set -u）不展开，避免 unbound variable
  for d in ${_MUTATE_TMP_DIRS[@]+"${_MUTATE_TMP_DIRS[@]}"}; do
    [[ -n "${d:-}" && -d "$d" ]] && rm -rf "$d" || true
  done
  return 0  # trap 不得覆盖脚本的退出码
}
trap _cleanup_all EXIT

# ── variant 注册表（表化，可扩展） ───────────────────────────────────────────
KNOWN_VARIANTS=(L0C-T02-orphan)

# emit_locked_spec <variant> → 锁定 spec 相对 REPO_ROOT 的路径
emit_locked_spec() {
  case "$1" in
    L0C-T02-orphan) echo "tests/L0C/T02-turn.spec.ts" ;;
    *) return 1 ;;
  esac
}

# emit_marker <variant> → 突变标记串（用于自验 sed/perl 是否 land）
emit_marker() {
  case "$1" in
    L0C-T02-orphan) echo "MUTATED:L0C-T02-orphan" ;;
    *) return 1 ;;
  esac
}

# emit_match <variant> → perl \Q\E 字面匹配串（含真实换行）
# 向 scenario-1（"pairs tool_use_id round-trip"，.not.toThrow()）的 transcript
# 注入孤儿 tool_result：匹配 "tool_use t1 + tool_result t1 + ];" 三段。
emit_match() {
  case "$1" in
    L0C-T02-orphan)
      printf '%s' '      toolResultBlock("t1", "result"),
    ];

    // 正常路径：不抛异常即通过'
      ;;
    *) return 1 ;;
  esac
}

# emit_replace <variant> → perl 替换串（注入孤儿 tool_result + 标记）
emit_replace() {
  case "$1" in
    L0C-T02-orphan)
      printf '%s' '      toolResultBlock("t1", "result"),
      toolResultBlock("t-orphan", "result"), /* MUTATED:L0C-T02-orphan */
    ];

    // 正常路径：不抛异常即通过'
      ;;
    *) return 1 ;;
  esac
}

# ── 工具函数 ─────────────────────────────────────────────────────────────────
# 跨平台 sha256（GNU sha256sum / BSD shasum）
_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# 对单个锁定文件执行 §1.2 规范 hash 比对。
# 关闭 gap (4): 原自检只比 before==after（被测文件当前 hash），若文件已被
# 先行篡改则原自检照样通过。现先与 TEST-LOCK.md §2 规范 hash 比对——不
# 匹配即拒（突变门不得在已篡改基线上启动）。
# 委托 scripts/lib/test-lock-check.mjs --file（同一 parser，单一真相源）。
_assert_lock_intact() {
  local rel="$1"
  local abs="$REPO_ROOT/$rel"
  if ! node "$SCRIPT_DIR/test-lock-check.mjs" --quiet --file "$abs" >/dev/null 2>&1; then
    echo "mutate-invariant: $rel sha256 ≠ TEST-LOCK §2 canonical (file already tampered?)" >&2
    return 1
  fi
  return 0
}

usage() {
  cat >&2 <<EOF
usage: mutate-invariant.sh <variant>            # 跑完整突变门
       mutate-invariant.sh --restore <variant>  # 清理（幂等 no-op）
       mutate-invariant.sh --list               # 列出已知 variant
known variants: ${KNOWN_VARIANTS[*]}
EOF
}

list_variants() {
  local v
  for v in "${KNOWN_VARIANTS[@]}"; do
    local f
    f="$(emit_locked_spec "$v")" || true
    printf '%s\t%s\n' "$v" "$f"
  done
}

# ── 核心突变门 ───────────────────────────────────────────────────────────────
# run_gate <variant>: 注入 tmp 副本 → 跑（应 fail）→ 清理 → 跑原 spec（应 pass）
# → sha256 自检 → exit 0
run_gate() {
  local variant="$1"
  local rel locked marker tmp_dir tmp_spec tmp_cfg
  local lock_sha_before lock_sha_after

  rel="$(emit_locked_spec "$variant")" || {
    echo "mutate-invariant: unknown variant '$variant'" >&2
    return 1
  }
  marker="$(emit_marker "$variant")" || return 1
  locked="$REPO_ROOT/$rel"

  if [[ ! -f "$locked" ]]; then
    echo "mutate-invariant: locked spec not found: $rel" >&2
    return 1
  fi

  # §1.2 规范 hash 入口比对：锁定文件必须与 TEST-LOCK.md §2 一致才能起跳。
  # 若文件已被先行篡改，下游 before==after 自检会照过——此处先行拒掉。
  _assert_lock_intact "$rel" || return 1

  # sha256 自检：跑前快照锁定文件
  lock_sha_before="$(_sha256 "$locked")"

  # 创建 tmp 工作区（mktemp 跨平台；登记到全局清理表）
  # BSD mktemp 默认模板落 /var/folders（忽略 $TMPDIR），嵌套沙箱拒写 → EPERM。
  # 显式模板钉在 $TMPDIR（沙箱可写区），GNU/BSD mktemp 均兼容。
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mut.XXXXXXXXXX" 2>/dev/null || mktemp -d -t mut)"
  _MUTATE_TMP_DIRS+=("$tmp_dir")
  tmp_spec="$tmp_dir/mutated.spec.ts"
  tmp_cfg="$tmp_dir/vitest.config.ts"

  # 1. cp 锁定 spec → tmp 副本（绝不写回原文件）
  cp "$locked" "$tmp_spec"

  # 2. perl 注入孤儿 tool_result 到 tmp 副本（\Q\E 字面匹配，含真实换行）
  local mut_match mut_replace
  mut_match="$(emit_match "$variant")"
  mut_replace="$(emit_replace "$variant")"
  export CLN_MUT_MATCH="$mut_match" CLN_MUT_REPLACE="$mut_replace"
  if ! perl -0777 -i -pe 's/\Q$ENV{CLN_MUT_MATCH}\E/$ENV{CLN_MUT_REPLACE}/' "$tmp_spec"; then
    echo "mutate-invariant: $variant — perl substitution failed" >&2
    return 1
  fi
  # 自验突变 land（marker 出现）—— 否则源契约漂移，突变是 no-op false-green
  if ! grep -q "$marker" "$tmp_spec"; then
    echo "mutate-invariant: $variant — mutation did not land (marker absent); source contract drifted" >&2
    return 1
  fi

  # 3. 临时 vitest config：隔离 include glob，root=REPO_ROOT 保证 @harness/l0-core 解析
  cat > "$tmp_cfg" <<EOF
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: "$REPO_ROOT",
  test: {
    include: ["$tmp_spec"],
    passWithNoTests: false,
  },
});
EOF

  # 4. 跑突变 tmp 副本 —— 必须 fail（exit≠0，不变量捕获孤儿 tool_result）
  #    若 pass → false-green（突变未被不变量捕获）→ 门失败
  if pnpm vitest run --config "$tmp_cfg" >/dev/null 2>&1; then
    echo "mutate-invariant: $variant — mutated tmp spec PASSED (false-green: mutation not caught by invariant)" >&2
    return 1
  fi

  # 5. 清理 tmp 副本（tmp 从未写回锁定文件）
  rm -rf "$tmp_dir"

  # 6. 跑原锁定 spec —— 必须 pass（exit 0，baseline 完好）
  if ! pnpm vitest run "$rel" >/dev/null 2>&1; then
    echo "mutate-invariant: $variant — original spec FAILED after gate (baseline not intact)" >&2
    return 1
  fi

  # 7. sha256 自检：锁定文件跑前后必须一致（helper 不得破坏锁定）
  lock_sha_after="$(_sha256 "$locked")"
  if [[ "$lock_sha_before" != "$lock_sha_after" ]]; then
    echo "mutate-invariant: $variant — locked spec sha256 changed (test-lock violated)" >&2
    return 1
  fi

  echo "mutate-invariant: $variant — gate passed (inject-fail / restore-pass / lock-intact)"
  return 0
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
  # cwd 固定到 repo root，保证 pnpm workspace + @harness/l0-core 解析
  cd "$REPO_ROOT"

  case "${1:-}" in
    --list)
      list_variants
      return 0
      ;;
    --restore)
      shift
      local v="${1:-}"
      if [[ -z "$v" ]] || ! emit_locked_spec "$v" >/dev/null 2>&1; then
        echo "mutate-invariant: unknown variant '${v:-}'" >&2
        return 1
      fi
      # 突变只在 tmp 副本上做，原锁定文件从未被改 → restore 为幂等 no-op。
      # 顶层 EXIT trap 也会清理任何残留 tmp 工作区。
      echo "mutate-invariant: $v — no-op restore (mutation is tmp-copy only)"
      return 0
      ;;
    --help|-h|"")
      usage
      return 2
      ;;
    *)
      local v="${1:-}"
      if ! emit_locked_spec "$v" >/dev/null 2>&1; then
        echo "mutate-invariant: unknown variant '$v'" >&2
        usage
        return 1
      fi
      run_gate "$v"
      ;;
  esac
}

main "$@"
