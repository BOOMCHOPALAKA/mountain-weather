#!/usr/bin/env bash
# tldr/publish.sh
# Publishes a checked TLDR brief to the Pages repo's main branch. The only file it ever commits is brief.json.
#
#   bash tldr/publish.sh <brief.json> <digest.json> [--dry-run]
#
# Order: check the brief (the gate, even if the caller already did), pull, copy the brief to ./brief.json, stage only that file,
# commit, push to main. --dry-run does everything except the push. Before every push (and every retry) the guard requires exactly
# one new commit over origin/main, touching only brief.json, with brief.json identical to the checked brief.
# Exit 0: pushed, "no change", or dry run done. Exit 1: check failed, unexpected staged files, the push guard refused, or every push attempt failed.
set -euo pipefail

usage() { echo "usage: bash tldr/publish.sh <brief.json> <digest.json> [--dry-run]" >&2; exit 2; }

DRY=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi
done
[ "${#ARGS[@]}" -eq 2 ] || usage

abspath() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
[ -f "${ARGS[0]}" ] || { echo "publish: brief not found: ${ARGS[0]}" >&2; exit 1; }
[ -f "${ARGS[1]}" ] || { echo "publish: digest not found: ${ARGS[1]}" >&2; exit 1; }
BRIEF="$(abspath "${ARGS[0]}")"
DIGEST="$(abspath "${ARGS[1]}")"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Gate: nothing touches git unless the checker passes.
if ! CHECK_OUT="$(node tldr/check.mjs "$DIGEST" "$BRIEF")"; then
  echo "publish: check failed, nothing published:" >&2
  echo "$CHECK_OUT" >&2
  exit 1
fi

if ! git pull --rebase -q origin main; then
  echo "publish: git pull --rebase failed (dirty checkout or conflict), nothing published" >&2
  git rebase --abort 2>/dev/null || true
  exit 1
fi

if [ "$BRIEF" != "$PWD/brief.json" ]; then cp "$BRIEF" brief.json; fi
git add brief.json

STAGED="$(git diff --cached --name-only)"
if [ -z "$STAGED" ]; then
  echo "publish: no change (brief.json already matches), nothing to commit"
  exit 0
fi
if [ "$STAGED" != "brief.json" ]; then
  echo "publish: refusing to commit, staged files are not exactly brief.json:" >&2
  echo "$STAGED" >&2
  exit 1
fi

STAMP="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M')"
IDENT=()
if [ -z "$(git config user.email || true)" ]; then
  IDENT=(-c user.name="mountain-weather tldr" -c user.email="tldr@users.noreply.github.com")
fi
git ${IDENT[@]+"${IDENT[@]}"} commit -q -m "tldr: $STAMP PT"
echo "publish: committed brief.json (tldr: $STAMP PT)"

if [ "$DRY" -eq 1 ]; then
  echo "publish: dry run, not pushing"
  exit 0
fi

# Runs right before every push, the retries too. The push goes out only when it carries exactly one commit over origin/main, that
# commit changes only brief.json, and brief.json is byte-identical to the brief the gate checked. Anything else exits 1.
push_guard() {
  if ! git fetch -q origin main; then
    echo "publish: git fetch failed, nothing published" >&2
    exit 1
  fi
  local ahead changed
  ahead="$(git rev-list --count origin/main..HEAD)"
  if [ "$ahead" != "1" ]; then
    echo "publish: refusing to push, HEAD is $ahead commits ahead of origin/main (need exactly 1), nothing published" >&2
    exit 1
  fi
  changed="$(git diff --name-only origin/main HEAD)"
  if [ "$changed" != "brief.json" ]; then
    echo "publish: refusing to push, the commit changes files other than brief.json, nothing published:" >&2
    echo "$changed" >&2
    exit 1
  fi
  if ! cmp -s brief.json "$BRIEF" || ! git show HEAD:brief.json | cmp -s - "$BRIEF"; then
    echo "publish: refusing to push, brief.json differs from the brief the check passed, nothing published" >&2
    exit 1
  fi
}

attempt=0
while :; do
  push_guard
  if git push -q origin HEAD:main; then
    echo "publish: pushed to main"
    exit 0
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 2 ]; then
    echo "publish: push failed after 2 retries" >&2
    exit 1
  fi
  echo "publish: push rejected, rebasing and retrying ($attempt of 2)" >&2
  if ! git pull --rebase -q origin main; then
    git rebase --abort 2>/dev/null || true
    echo "publish: rebase failed, giving up" >&2
    exit 1
  fi
done
