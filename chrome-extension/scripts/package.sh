#!/usr/bin/env bash
# Build a Chrome Web Store upload package from chrome-extension/.
#
# The `key` field (which pins the ID for local unpacked dev) is stripped: the
# Web Store assigns its own ID on first upload. After publishing, register the
# store's redirect URL (https://<store-id>.chromiumapp.org/) on the Cognito app
# client in infra/lib/api-stack.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dist/recipator-extension.zip"
rm -rf dist .pkg-build
mkdir -p dist .pkg-build

cp -R icons src .pkg-build/
jq 'del(.key)' manifest.json > .pkg-build/manifest.json

( cd .pkg-build && zip -rq "../$OUT" . -x '*.DS_Store' )
rm -rf .pkg-build

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT"
