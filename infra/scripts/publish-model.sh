#!/usr/bin/env bash
# Publish the on-device embedding model to the Recipator models bucket.
#
# Zips the CoreML .mlpackage, computes its sha256, uploads it + a manifest.json
# that GET /model serves. Run AFTER the model has been converted (see
# experiments/coreml/convert.py) and the CDK stack deployed.
#
# Usage: AWS_PROFILE=nakom.is-sandbox ./publish-model.sh sandbox
#        AWS_PROFILE=nakom.is-admin   ./publish-model.sh prod
set -euo pipefail

ENV="${1:?usage: publish-model.sh <sandbox|prod>}"
VERSION="mxbai-v1"
PREFIX_KEY="mxbai/v1"
BUCKET="recipator-models-${ENV}"
REGION="eu-west-2"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="${ROOT}/experiments/coreml/out/mxbai.mlpackage"
QUERY_PREFIX="Represent this sentence for searching relevant passages: "

[ -d "$PKG" ] || { echo "❌ model not found at $PKG — run experiments/coreml/convert.py first"; exit 1; }

TMP="$(mktemp -d)"
ZIP="${TMP}/model.mlpackage.zip"
echo "Zipping $PKG ..."
( cd "$(dirname "$PKG")" && zip -qr -X "$ZIP" "$(basename "$PKG")" )

SHA="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
SIZE="$(stat -f%z "$ZIP" 2>/dev/null || stat -c%s "$ZIP")"
echo "sha256=$SHA  size=$SIZE bytes"

ARTIFACT_KEY="${PREFIX_KEY}/model.mlpackage.zip"
MANIFEST_KEY="${PREFIX_KEY}/manifest.json"

cat > "${TMP}/manifest.json" <<JSON
{
  "version": "${VERSION}",
  "artifactKey": "${ARTIFACT_KEY}",
  "sha256": "${SHA}",
  "dim": 1024,
  "queryPrefix": "${QUERY_PREFIX}"
}
JSON

echo "Uploading to s3://${BUCKET}/${PREFIX_KEY}/ ..."
aws s3 cp "$ZIP" "s3://${BUCKET}/${ARTIFACT_KEY}" --region "$REGION"
aws s3 cp "${TMP}/manifest.json" "s3://${BUCKET}/${MANIFEST_KEY}" --region "$REGION" \
  --content-type application/json

rm -rf "$TMP"
echo "✓ published ${VERSION} to ${BUCKET}"
