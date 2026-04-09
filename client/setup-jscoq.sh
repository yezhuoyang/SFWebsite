#!/bin/bash
# Copy jsCoq WASM worker and all required assets to public/ for Vite to serve.
#
# From access logs, the WA worker (at /jscoq/dist/wacoq_worker.js) requests:
#   IcoqPod constructor: binDir="../backend/wasm", nmDir="../../../node_modules"
#   boot():           ../backend/wasm/wacoq_worker.bc  → /jscoq/backend/wasm/wacoq_worker.bc
#   _preloadStub():   ${binDir}/dllcoqrun_stubs.wasm   → /jscoq/backend/wasm/dllcoqrun_stubs.wasm
#                     ${binDir}/dlllib_stubs.wasm       → /jscoq/backend/wasm/dlllib_stubs.wasm
#                     ${nmDir}/@ocaml-wasm/*/bin/*.wasm → /node_modules/@ocaml-wasm/*/bin/*.wasm
#   OCamlExecutable:  ${nmDir}/ocaml-wasm/bin/*.wasm   → /node_modules/ocaml-wasm/bin/*.wasm

set -e

JSCOQ="public/jscoq"
NMODS="public/node_modules"

rm -rf "$JSCOQ" "$NMODS"

# --- jsCoq directory ---
mkdir -p "$JSCOQ/dist" "$JSCOQ/backend/jsoo" "$JSCOQ/backend/wasm" "$JSCOQ/coq-pkgs"

# WA worker entry point
cp node_modules/jscoq/dist/wacoq_worker.js "$JSCOQ/dist/"

# JS backend worker (kept as fallback)
cp node_modules/jscoq/backend/jsoo/jscoq_worker.bc.js "$JSCOQ/backend/jsoo/"

# WASM binaries: bytecode + stubs (binDir = ../backend/wasm)
cp node_modules/jscoq/backend/wasm/wacoq_worker.bc "$JSCOQ/backend/wasm/"
cp node_modules/jscoq/backend/wasm/dllcoqrun_stubs.wasm "$JSCOQ/backend/wasm/"
cp node_modules/jscoq/backend/wasm/dlllib_stubs.wasm "$JSCOQ/backend/wasm/"

# Coq packages
cp node_modules/jscoq/coq-pkgs/*.coq-pkg "$JSCOQ/coq-pkgs/"
cp node_modules/jscoq/coq-pkgs/*.json "$JSCOQ/coq-pkgs/" 2>/dev/null || true
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.coq-pkg "$JSCOQ/coq-pkgs/"
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.json "$JSCOQ/coq-pkgs/" 2>/dev/null || true

# --- node_modules at site root (nmDir = ../../../node_modules from dist/) ---
mkdir -p "$NMODS/ocaml-wasm/bin"
cp node_modules/ocaml-wasm/bin/*.wasm "$NMODS/ocaml-wasm/bin/"

for pkg in node_modules/@ocaml-wasm/*/; do
  pkgname=$(basename "$pkg")
  mkdir -p "$NMODS/@ocaml-wasm/$pkgname/bin"
  cp "$pkg/bin/"*.wasm "$NMODS/@ocaml-wasm/$pkgname/bin/" 2>/dev/null || true
done

echo "Done. Verifying:"
for f in \
  "$JSCOQ/dist/wacoq_worker.js" \
  "$JSCOQ/backend/wasm/wacoq_worker.bc" \
  "$JSCOQ/backend/wasm/dllcoqrun_stubs.wasm" \
  "$JSCOQ/backend/wasm/dlllib_stubs.wasm" \
  "$NMODS/ocaml-wasm/bin/ocamlrun.wasm" \
  "$NMODS/ocaml-wasm/bin/dllcamlstr.wasm" \
  "$NMODS/@ocaml-wasm/4.12--zarith/bin/dllzarith.wasm"; do
  if [ -f "$f" ]; then echo "  OK $f"; else echo "  MISSING $f"; fi
done
du -sh "$JSCOQ" "$NMODS"
