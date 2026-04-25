#!/usr/bin/env bash
# Pre-ship diff review for mizresearch.
#
# Collects `git diff HEAD`, `git diff --cached`, status, and recent commits
# into a single prompt bundle, then either:
#   (a) pipes it into `claude -p` if the Claude Code CLI is on PATH, or
#   (b) writes the bundle to a file and tells you where it is so you can
#       paste it into an active Claude Code session.
#
# Usage:
#   ./scripts/review.sh             # review working tree vs HEAD
#   ./scripts/review.sh --staged    # review only staged changes
#   ./scripts/review.sh --base main # review current branch vs main
#
# Exit codes:
#   0 — review produced (or nothing to review)
#   1 — not in a git repo / prompt template missing
#   2 — git diff failed

set -euo pipefail

# Resolve repo root (script lives at <repo>/scripts/review.sh).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROMPT_TEMPLATE="$REPO_ROOT/.claude/review-prompt.md"
if [[ ! -f "$PROMPT_TEMPLATE" ]]; then
    echo "error: prompt template not found at $PROMPT_TEMPLATE" >&2
    exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "error: not in a git repository" >&2
    exit 1
fi

# Parse args.
MODE="worktree"  # worktree | staged | branch
BASE_BRANCH=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --staged) MODE="staged"; shift ;;
        --base)   MODE="branch"; BASE_BRANCH="${2:?--base needs a branch name}"; shift 2 ;;
        -h|--help)
            sed -n '2,14p' "$0"
            exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 1 ;;
    esac
done

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$REPO_ROOT/.claude/reviews"
mkdir -p "$OUT_DIR"
BUNDLE="$OUT_DIR/review-$TS.md"

# Collect git context.
case "$MODE" in
    staged)   DIFF_RANGE="--cached"; DIFF_LABEL="staged changes" ;;
    worktree) DIFF_RANGE="HEAD";     DIFF_LABEL="working tree vs HEAD" ;;
    branch)   DIFF_RANGE="$BASE_BRANCH...HEAD"; DIFF_LABEL="$BRANCH vs $BASE_BRANCH" ;;
esac

DIFF_OUT="$(git diff $DIFF_RANGE 2>&1)" || { echo "git diff failed"; exit 2; }
if [[ -z "$DIFF_OUT" ]]; then
    echo "no changes in $DIFF_LABEL — nothing to review"
    exit 0
fi

STATUS_OUT="$(git status --short)"
LOG_OUT="$(git log --oneline -5)"

# Build the bundle: prompt template + inputs.
{
    cat "$PROMPT_TEMPLATE"
    echo
    echo "---"
    echo
    echo "## Inputs"
    echo
    echo "**Branch**: \`$BRANCH\`  "
    echo "**HEAD**: \`$SHORT_SHA\`  "
    echo "**Review mode**: $DIFF_LABEL"
    echo
    echo "### git status --short"
    echo '```'
    echo "${STATUS_OUT:-(clean)}"
    echo '```'
    echo
    echo "### Recent commits"
    echo '```'
    echo "$LOG_OUT"
    echo '```'
    echo
    echo "### Diff"
    echo '```diff'
    echo "$DIFF_OUT"
    echo '```'
} > "$BUNDLE"

SIZE_KB=$(( $(wc -c < "$BUNDLE") / 1024 ))
LINES=$(wc -l < "$BUNDLE")
echo "bundle: $BUNDLE ($SIZE_KB KB, $LINES lines)"

# Try to invoke the Claude CLI if available. Both POSIX `claude` and the
# Windows `claude.cmd` wrapper are checked.
CLAUDE_BIN=""
if command -v claude >/dev/null 2>&1; then
    CLAUDE_BIN="claude"
elif command -v claude.cmd >/dev/null 2>&1; then
    CLAUDE_BIN="claude.cmd"
fi

if [[ -n "$CLAUDE_BIN" ]]; then
    echo "invoking $CLAUDE_BIN -p ..."
    echo
    "$CLAUDE_BIN" -p < "$BUNDLE"
else
    cat <<EOF

Claude CLI not found on PATH. The review bundle is ready at:
  $BUNDLE

To run it, either:
  1. Install the Claude Code CLI and re-run ./scripts/review.sh
  2. Open your active Claude Code session and say:
       "review this: $BUNDLE"
  3. Copy/paste the bundle contents into a Claude conversation.

EOF
fi
