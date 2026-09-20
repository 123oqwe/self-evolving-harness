#!/usr/bin/env bash
# scripts/install-pre-commit.sh — install the test-lock sha256 pre-commit hook.
#
# Closes gap (3) of the TEST-LOCK §1.2 enforcement audit: the L0C-T08
# pre-commit hook (checkDiff) was never installed in this repo, and even when
# installed it only inspects 5 dangerous-diff kinds — it never verifies the
# sha256 of locked tests/** files. This installer writes a .git/hooks/pre-commit
# that runs scripts/lib/test-lock-check.mjs, blocking any commit whose staged
# tree contains a tampered/deleted/extra locked test file.
#
# Local hooks are bypassable with `git commit --no-verify`; the non-bypassable
# backstop is the .github/workflows/ci.yml `test-lock` job. This installer is
# the fast local-feedback layer.
#
# Usage:  bash scripts/install-pre-commit.sh [--force]
#   --force  overwrite an existing non-sample pre-commit hook.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

if [[ ! -d "$REPO_ROOT/.git/hooks" ]]; then
  echo "install-pre-commit: .git/hooks not found — not a git workdir?" >&2
  exit 1
fi

force=0
[[ "${1:-}" == "--force" ]] && force=1

if [[ -f "$HOOK" ]]; then
  # Preserve existing hooks unless --force. Detect sample hooks (safe to overwrite).
  if grep -q "test-lock-check.mjs" "$HOOK"; then
    echo "install-pre-commit: test-lock hook already installed ($HOOK)"
    exit 0
  fi
  if [[ $force -ne 1 ]] && ! grep -q "sample" "$HOOK"; then
    echo "install-pre-commit: $HOOK exists and is not a sample — use --force to overwrite" >&2
    exit 1
  fi
fi

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/install-pre-commit.sh — TEST-LOCK §1.2 sha256 gate.
# Blocks commits that tamper with locked tests/** files. Bypassable via
# --no-verify; the CI `test-lock` job is the non-bypassable backstop.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
node "$REPO_ROOT/scripts/lib/test-lock-check.mjs" --quiet
EOF
chmod +x "$HOOK"
echo "install-pre-commit: installed test-lock sha256 hook → $HOOK"
echo "  (bypass with --no-verify; CI test-lock job is the hard backstop)"
