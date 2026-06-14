#!/usr/bin/env bash
# Build + push the embed-Lambda container image to the shared nakomis-lambda-images
# ECR repo (defined in nakomis-infra), and record the resolved tag for CDK to consume.
#
# Idempotent: the image is tagged by a content hash of its build inputs
# (Dockerfile + requirements.txt + handler.py). Same inputs -> same tag. If that tag
# already exists in ECR we skip the build and push entirely — so re-runs are a single
# cheap API call and only a genuine change triggers a rebuild.
#
# The CDK stack derives the very same tag independently (infra/lib/embed-image-tag.ts)
# and references the image with lambda.DockerImageCode.fromEcr(repo, { tagOrDigest }),
# so there is no artifact to hand over — both sides hash the same files.
#
# Usage: AWS_PROFILE=nakom.is-sandbox ./publish-embed-image.sh sandbox
#        AWS_PROFILE=nakom.is-admin   ./publish-embed-image.sh prod
set -euo pipefail

ENV="${1:?usage: publish-embed-image.sh <sandbox|prod>}"
REGION="eu-west-2"
REPO="nakomis-lambda-images"   # contract with nakomis-infra (EcrStack)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMBED_DIR="$(cd "${SCRIPT_DIR}/../lambda/embed" && pwd)"

# Content hash over the build inputs, in a fixed order. cat concatenates raw bytes,
# so the digest changes iff one of these files changes. shasum is preinstalled on macOS.
# MUST stay in lockstep with embedImageTag() in infra/lib/embed-image-tag.ts.
HASH="$(cat "${EMBED_DIR}/Dockerfile" "${EMBED_DIR}/requirements.txt" "${EMBED_DIR}/handler.py" \
  | shasum -a 256 | cut -c1-12)"
TAG="recipator-embed-${HASH}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${REPO}:${TAG}"

echo "embed image tag: ${TAG}"

if aws ecr describe-images --region "$REGION" --repository-name "$REPO" \
     --image-ids "imageTag=${TAG}" >/dev/null 2>&1; then
  echo "  already in ECR — skipping build and push."
else
  echo "  not in ECR — building (amd64) and pushing ..."
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY"
  # amd64 to match the x86_64 Lambda function. Native on the x86 CI runners (no QEMU);
  # emulated if ever run on an Apple Silicon host. Must agree with the function's
  # architecture or the Lambda fails at invoke with an exec-format error.
  docker build --platform linux/amd64 -t "$IMAGE" "$EMBED_DIR"
  docker push "$IMAGE"
  echo "  pushed ${IMAGE}"
fi
