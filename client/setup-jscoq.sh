#!/bin/bash
# Copy jsCoq worker and package assets to public/ for Vite to serve.
# Run after npm install (or manually: bash setup-jscoq.sh)

set -e

DEST="public/jscoq"

# Clean previous copy
rm -rf "$DEST"
mkdir -p "$DEST/backend/jsoo" "$DEST/coq-pkgs"

# Worker script
cp node_modules/jscoq/backend/jsoo/jscoq_worker.bc.js "$DEST/backend/jsoo/"

# Core Coq packages
cp node_modules/jscoq/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/jscoq/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true
cp node_modules/jscoq/coq-pkgs/*.symb.json "$DEST/coq-pkgs/" 2>/dev/null || true

# Software Foundations packages
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.coq-pkg "$DEST/coq-pkgs/"
cp node_modules/@jscoq/software-foundations/coq-pkgs/*.json "$DEST/coq-pkgs/" 2>/dev/null || true

echo "jsCoq assets copied to $DEST"
ls -lh "$DEST/backend/jsoo/"
ls -lh "$DEST/coq-pkgs/"
