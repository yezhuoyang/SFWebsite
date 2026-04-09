#!/bin/bash
# Copy jsCoq worker and package assets to public/ for Vite to serve.
# Run after npm install (or manually: bash setup-jscoq.sh)

set -e

DEST="public/jscoq"

# Clean previous copy
rm -rf "$DEST"
mkdir -p "$DEST/backend/jsoo" "$DEST/backend/wasm" "$DEST/dist" "$DEST/coq-pkgs"

# JS backend worker
cp node_modules/jscoq/backend/jsoo/jscoq_worker.bc.js "$DEST/backend/jsoo/"

# WASM backend worker + binaries
cp node_modules/jscoq/dist/wacoq_worker.js "$DEST/dist/"
cp node_modules/jscoq/backend/wasm/wacoq_worker.bc "$DEST/backend/wasm/"
cp node_modules/jscoq/backend/wasm/*.wasm "$DEST/backend/wasm/"

# Core Coq packages
cp node_modules/jscoq/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/jscoq/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true
cp node_modules/jscoq/coq-pkgs/*.symb.json "$DEST/coq-pkgs/" 2>/dev/null || true

# Software Foundations packages
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true

echo "jsCoq assets copied to $DEST"
echo "--- JS backend ---"
ls -lh "$DEST/backend/jsoo/"
echo "--- WASM backend ---"
ls -lh "$DEST/dist/"
ls -lh "$DEST/backend/wasm/"
echo "--- Packages ---"
ls -lh "$DEST/coq-pkgs/"
