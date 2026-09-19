#!/usr/bin/env bash
# scripts/mutate-invariant.sh — L0C invariant mutation injection harness.
#
# Spec: execution/L0-core/TASKS.md §L0C-T09a (ERRATA-w2plus L0C-03).
#
#   "突变注入脚本（scripts/mutate-invariant.sh）"
#   "突变注入用 git stash + sed + 跑 + git checkout 恢复，确保测试间隔离。"
#
# Each invariant maps to a destructive `sed` mutation on a specific L0C source
# file (T02 deliverables). The inject step saves a `.mutate-bak` copy of the
# target file BEFORE mutating; the restore step copies it back. This is
# self-contained — it does NOT depend on git working-tree state, so it is safe
# to run even when other files in the workspace have uncommitted changes from
# parallel tasks. (The spec's `git stash`/`git checkout` hint is one valid
# isolation strategy; a backup-copy is the equivalent, strictly non-destructive
# form used here so the script never touches unrelated git state.)
#
# A mutation marker `/* MUTATED:<INV> */` is appended on the mutated line so the
# inject step can self-verify the sed actually matched (idempotency guard: an
# already-mutated file is refused to avoid double-mutation / lost backups).
#
# Usage:
#   bash scripts/mutate-invariant.sh <invariant>           # inject mutation
#   bash scripts/mutate-invariant.sh --restore <invariant>  # restore original
#   bash scripts/mutate-invariant.sh --list                 # list known invariants
#
# Exit codes:
#   0  inject applied / restore succeeded (or no-op restore when not mutated)
#   1  unknown invariant / sed did not match / already mutated / restore failed
#   2  usage error
#
# Invariants registered (T09a):
#   L0C-T09a-turn-boundary  — isLegalInsertionPoint(mid_turn) forced true
#   L0C-T09a-orphan-400     — OrphanToolResultError.statusCode forced 200
# (T09b will append five more invariants to this same script per spec.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── invariant registry ──────────────────────────────────────────────────────
# Each invariant declares:
#   REL_FILE  — path relative to REPO_ROOT of the source file to mutate
#   MATCH     — the exact sed BRE pattern that must be present (pre-mutation)
#   REPLACE   — the sed replacement (the destructive change + marker)
# ─────────────────────────────────────────────────────────────────────────────

emit_file()    { case "$1" in L0C-T09a-turn-boundary) echo "packages/l0-core/src/transcript/turn.ts";; L0C-T09a-orphan-400) echo "packages/l0-core/src/transcript/tool-use-id.ts";; *) return 1;; esac; }
emit_match()   { case "$1" in L0C-T09a-turn-boundary) echo 'return point === "turn_end" && this.#phase === "turn_end";';; L0C-T09a-orphan-400) echo 'this.statusCode = 400;';; *) return 1;; esac; }
emit_replace() { case "$1" in L0C-T09a-turn-boundary) echo 'return true; /* MUTATED:L0C-T09a-turn-boundary */';; L0C-T09a-orphan-400) echo 'this.statusCode = 200; /* MUTATED:L0C-T09a-orphan-400 */';; *) return 1;; esac; }

KNOWN_INVARIANTS=(L0C-T09a-turn-boundary L0C-T09a-orphan-400)

usage() {
  cat >&2 <<EOF
usage: mutate-invariant.sh <invariant>          # inject
       mutate-invariant.sh --restore <invariant> # restore
       mutate-invariant.sh --list                # list invariants
known invariants: ${KNOWN_INVARIANTS[*]}
EOF
}

list_invariants() {
  for inv in "${KNOWN_INVARIANTS[@]}"; do
    local f m
    f="$(emit_file "$inv")" || true
    m="$(emit_match "$inv")" || true
    printf '%s\t%s\t%s\n' "$inv" "$f" "$m"
  done
}

# inject <invariant>
inject() {
  local inv="$1"
  local rel f match replace target bak marker

  rel="$(emit_file "$inv")" || { echo "mutate-invariant: unknown invariant '$inv'" >&2; return 1; }
  match="$(emit_match "$inv")" || return 1
  replace="$(emit_replace "$inv")" || return 1

  target="$REPO_ROOT/$rel"
  bak="$target.mutate-bak"
  marker="MUTATED:$inv"

  if [[ ! -f "$target" ]]; then
    echo "mutate-invariant: target file not found: $target" >&2
    return 1
  fi

  # Idempotency guard — refuse to mutate an already-mutated file.
  if grep -q "$marker" "$target"; then
    echo "mutate-invariant: $inv already injected (marker present); run --restore first" >&2
    return 1
  fi

  # Pre-mutation sanity: the expected pattern must be present (otherwise the
  # source contract drifted and the mutation would be a no-op false-green).
  if ! grep -qF "$match" "$target"; then
    echo "mutate-invariant: $inv — pre-mutation pattern not found in $rel; source contract drifted" >&2
    return 1
  fi

  # Save backup, then mutate. perl -i with \Q..\E gives exact literal
  # substitution reliably across BSD+GNU sed differences (and dodges the
  # BSD sed `-i` backup-arg portability trap). The s{...}{...} generalized
  # form avoids `/`-delimiter collisions with the replacement (which contains
  # `/* ... */`). The replacement text contains no `{`/`}`/`$`, so it is safe
  # to interpolate literally into the perl program.
  cp "$target" "$bak"
  if ! perl -i -pe "s{\\Q$match\\E}{$replace}" "$target"; then
    cp "$bak" "$target" && rm -f "$bak"
    echo "mutate-invariant: $inv — perl substitution failed" >&2
    return 1
  fi

  # Verify the mutation actually landed.
  if ! grep -q "$marker" "$target"; then
    cp "$bak" "$target" && rm -f "$bak"
    echo "mutate-invariant: $inv — substitution did not land (no marker); restored backup" >&2
    return 1
  fi

  echo "mutate-invariant: injected $inv into $rel"
  return 0
}

# restore <invariant>
restore() {
  local inv="$1"
  local rel f target bak

  rel="$(emit_file "$inv")" || { echo "mutate-invariant: unknown invariant '$inv'" >&2; return 1; }
  target="$REPO_ROOT/$rel"
  bak="$target.mutate-bak"

  if [[ -f "$bak" ]]; then
    cp "$bak" "$target"
    rm -f "$bak"
    echo "mutate-invariant: restored $inv from backup"
    return 0
  fi

  # No backup → not mutated by this script. Treat as success (no-op restore) so
  # verify.sh's restore step is idempotent and never false-fails.
  echo "mutate-invariant: $inv — no backup present (not mutated); no-op restore"
  return 0
}

main() {
  local mode="inject"
  local inv=""

  case "${1:-}" in
    --restore)
      mode="restore"
      shift
      inv="${1:-}"
      ;;
    --list)
      list_invariants
      return 0
      ;;
    --help|-h|"")
      usage
      return 2
      ;;
    *)
      inv="${1:-}"
      ;;
  esac

  if [[ -z "$inv" ]]; then
    usage
    return 2
  fi

  # Reject unknown invariants up-front (so --list stays the source of truth).
  if ! emit_file "$inv" >/dev/null 2>&1; then
    echo "mutate-invariant: unknown invariant '$inv'" >&2
    usage
    return 1
  fi

  case "$mode" in
    inject)  inject "$inv" ;;
    restore) restore "$inv" ;;
  esac
}

main "$@"
