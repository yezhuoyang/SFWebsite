#!/usr/bin/env bash
# Download SF book HTMLs directly from coq.vercel.app.
#
# Why: the user's local <vol>/*.html files are tied to whatever .v
# source revision was on disk when they were generated. The bundled
# `@jscoq/software-foundations` (March 2021) and the current local
# .v files (Apr 2026 with `Declare Custom Entry assn`) don't match
# each other, so neither set of HTMLs renders correctly against the
# .vo files we ship.
#
# coq.vercel.app's `/ext/sf/<vol>/full/*.html` is a self-consistent
# pair with `@wacoq/software-foundations` (which we also fetched into
# client/public/jscoq/coq-pkgs/). Use it as our source of truth.
#
# Run: bash scripts/download-sf-html.sh
# Then: npm run sf:stage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="https://coq.vercel.app/ext/sf"
TMP="$ROOT/.sf-vercel"

mkdir -p "$TMP"

for vol in lf plf vfa slf; do
  echo "[$vol] downloading file list..."
  toc_html="$TMP/$vol-toc.html"
  curl -sf -o "$toc_html" "$BASE/$vol/full/toc.html" || { echo "  failed: $vol/full/toc.html"; continue; }
  # Extract chapter filenames from the TOC (anchors of the form href="<Name>.html")
  chapters=$(grep -oE 'href="[A-Za-z0-9_]+\.html"' "$toc_html" \
    | sed -E 's|href="([^"]+)\.html"|\1|' \
    | sort -u)
  if [ -z "$chapters" ]; then
    echo "  no chapter links found, skipping"
    continue
  fi
  vol_out="$ROOT/$vol"
  mkdir -p "$vol_out"
  count=0
  fail=0
  for ch in $chapters toc index coqindex deps; do
    if curl -sf -o "$vol_out/$ch.html" "$BASE/$vol/full/$ch.html"; then
      count=$((count+1))
    else
      fail=$((fail+1))
    fi
  done
  echo "[$vol] downloaded $count, failed $fail"
done

echo
echo "Done. Now re-run: npm run sf:stage"
