#!/usr/bin/env bash
# Regenerate SF book HTML files from the current .v sources.
#
# The HTMLs bundled in ../lf, ../plf, ../vfa, ../slf were generated
# months before the .v files were updated, so chapters like
# plf/Hoare.v whose source now defines the `Custom Entry assn` +
# `Notation "{{ e }}"` system end up with HTML pages that lack those
# code blocks — the IDE then errors out with "Unknown interpretation
# for notation `{ { _ } }`" the moment a Definition uses {{ ... }}.
#
# Run: bash scripts/regen-sf-html.sh
# Then: npm run sf:stage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COQDOC="${COQDOC:-coqdoc}"

if ! command -v "$COQDOC" >/dev/null 2>&1; then
  echo "coqdoc not found in PATH. Set COQDOC=/path/to/coqdoc or install Coq Platform." >&2
  exit 1
fi

for vol in lf plf vfa slf; do
  dir="$ROOT/$vol"
  if [ ! -d "$dir" ]; then
    echo "skip $vol: $dir missing" >&2
    continue
  fi
  cd "$dir"
  vfiles=$(ls *.v 2>/dev/null)
  echo "[$vol] regenerating $(echo "$vfiles" | wc -w) HTML files"
  # Same flags as the SF Makefile.coq's html target.
  #
  # We deliberately omit `-Q . <NS>`: with it, coqdoc names the output
  # `<NS>.<Mod>.html` (e.g. PLF.Hoare.html) instead of `<Mod>.html`,
  # which our staging script + intra-volume links expect.
  #
  # We also drop `-toc`. With `-toc`, coqdoc generates a separate
  # `toc.html` that is plain (no SF book chrome), clobbering the
  # SF-styled `toc.html` shipped alongside the .v files. The chapter
  # HTMLs already include their own per-page section TOCs; we don't
  # need the global one.
  "$COQDOC" -interpolate -utf8 -html $vfiles 2>&1 \
    | grep -v "^Warning: " || true
done

echo
echo "Done. Now re-run: npm run sf:stage"
