#!/bin/bash
# Copy jsCoq worker and package assets to public/ for Vite to serve.
# Run after npm install (or manually: bash setup-jscoq.sh)

set -e

DEST="public/jscoq"

# Clean previous copy
rm -rf "$DEST"
mkdir -p "$DEST/backend/jsoo" "$DEST/coq-pkgs"

# JS backend worker
cp node_modules/jscoq/backend/jsoo/jscoq_worker.bc.js "$DEST/backend/jsoo/"

# WASM backend: wacoq_worker.js is at dist/, it uses relative paths:
#   ../bin/                         → jscoq/bin/
#   ../node_modules/ocaml-wasm/bin/ → jscoq/node_modules/ocaml-wasm/bin/
#   ../node_modules/@ocaml-wasm/   → jscoq/node_modules/@ocaml-wasm/
mkdir -p "$DEST/dist" "$DEST/bin" "$DEST/node_modules/ocaml-wasm/bin"
cp node_modules/jscoq/dist/wacoq_worker.js "$DEST/dist/"

# WASM binary + stubs (into bin/ which is ../bin relative to dist/wacoq_worker.js)
cp node_modules/jscoq/backend/wasm/wacoq_worker.bc "$DEST/bin/"
cp node_modules/jscoq/backend/wasm/*.wasm "$DEST/bin/"

# OCaml WASM runtime
cp node_modules/ocaml-wasm/bin/*.wasm "$DEST/node_modules/ocaml-wasm/bin/"

# @ocaml-wasm packages
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
