#!/bin/bash
# Copy jsCoq worker and package assets to public/ for Vite to serve.
# The WA worker at dist/wacoq_worker.js uses these relative paths:
#   ../backend/wasm/wacoq_worker.bc     (OCaml bytecode)
#   ../bin/*.wasm                       (binDir default = ../bin)
#   ../node_modules/ocaml-wasm/bin/*.wasm  (OCaml runtime)
#   ../node_modules/@ocaml-wasm/*/bin/*.wasm  (OCaml packages)
# Run after npm install (or manually: bash setup-jscoq.sh)

set -e

DEST="public/jscoq"

# Clean previous copy
rm -rf "$DEST"

# Create directory structure matching npm package layout
mkdir -p "$DEST/dist"
mkdir -p "$DEST/backend/jsoo"
mkdir -p "$DEST/backend/wasm"
mkdir -p "$DEST/bin"
mkdir -p "$DEST/node_modules/ocaml-wasm/bin"
mkdir -p "$DEST/coq-pkgs"

# JS backend worker (kept as fallback)
cp node_modules/jscoq/backend/jsoo/jscoq_worker.bc.js "$DEST/backend/jsoo/"

# WA worker entry point
cp node_modules/jscoq/dist/wacoq_worker.js "$DEST/dist/"

# WA backend: OCaml bytecode + Coq WASM stubs
# boot() fetches ../backend/wasm/wacoq_worker.bc
cp node_modules/jscoq/backend/wasm/wacoq_worker.bc "$DEST/backend/wasm/"
# _preloadStub() fetches from ${binDir}/ which defaults to ../bin/
cp node_modules/jscoq/backend/wasm/dllcoqrun_stubs.wasm "$DEST/bin/"
cp node_modules/jscoq/backend/wasm/dlllib_stubs.wasm "$DEST/bin/"

# OCaml runtime: ocamlrun.wasm + stdlib stubs
# OCamlExecutable.run() uses binDir = ${nmDir}/ocaml-wasm/bin/
# and preloads() uses the same binDir
# BUT the default for run()'s bin is opts.binDir || "../bin"
# The IcoqPod sets: binDir = "../bin" and OCamlExecutable.opts.binDir = "${nmDir}/ocaml-wasm/bin"
# So ocamlrun.wasm comes from ${nmDir}/ocaml-wasm/bin/ocamlrun.wasm
# And dllcamlstr.wasm etc come from the SAME ${nmDir}/ocaml-wasm/bin/
cp node_modules/ocaml-wasm/bin/*.wasm "$DEST/node_modules/ocaml-wasm/bin/"

# @ocaml-wasm packages (zarith, janestreet-base)
for pkg in node_modules/@ocaml-wasm/*/; do
  pkgname=$(basename "$pkg")
  mkdir -p "$DEST/node_modules/@ocaml-wasm/$pkgname/bin"
  cp "$pkg/bin/"*.wasm "$DEST/node_modules/@ocaml-wasm/$pkgname/bin/" 2>/dev/null || true
done

# Core Coq packages
cp node_modules/jscoq/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/jscoq/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true

# Software Foundations packages
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true

echo "jsCoq assets copied to $DEST"
du -sh "$DEST"
echo "Verifying key files:"
for f in dist/wacoq_worker.js backend/wasm/wacoq_worker.bc bin/dllcoqrun_stubs.wasm node_modules/ocaml-wasm/bin/ocamlrun.wasm; do
  echo "  $f: $(ls -lh "$DEST/$f" 2>/dev/null | awk '{print $5}' || echo 'MISSING')"
done
