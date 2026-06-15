#!/usr/bin/env bash
# Backfill (or re-embed) recipe embeddings via the embed-Lambda.
#
# Default: scans for items with no `embedding` attribute and async-invokes the
# embed-Lambda (recipator-embed-<env>) once per recipe, exactly as /extract does for
# new scrapes. Safe to re-run — already-embedded recipes are skipped, and the
# embed-Lambda is idempotent (it overwrites the vector).
#
# --remodel: after switching the embedding model, ALSO re-embed every recipe whose
# stored embeddingModel tag is not the current one (TARGET_MODEL). Use this to migrate
# the whole corpus to a new model. Recipes already on the target tag are skipped, so
# it's safe to re-run until the count reaches 0.
#
# Run AFTER the CDK stack is deployed and the (new) embed-Lambda image is live.
#
# Usage: AWS_PROFILE=nakom.is-sandbox ./backfill-embeddings.sh sandbox [--remodel] [--dry-run]
#        AWS_PROFILE=nakom.is-admin   ./backfill-embeddings.sh prod    [--remodel] [--dry-run]
#
#   --dry-run   list the recipes that would be embedded, but invoke nothing
#   --remodel   also re-embed recipes whose embeddingModel != the current model tag
set -euo pipefail

# Current on-device/server model tag — keep in lockstep with MODEL_TAG in
# infra/lambda/embed/handler.py. --remodel re-embeds anything not on this tag.
TARGET_MODEL="bge-base-v1"

ENV="${1:?usage: backfill-embeddings.sh <sandbox|prod> [--remodel] [--dry-run]}"
DRY_RUN=false
REMODEL=false
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --remodel) REMODEL=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REGION="eu-west-2"
TABLE="recipator-recipes-${ENV}"
FUNCTION="recipator-embed-${ENV}"

# Default: only recipes with no embedding. --remodel: those plus any on a stale model tag.
if $REMODEL; then
  FILTER='(attribute_not_exists(embedding) OR attribute_not_exists(embeddingModel) OR embeddingModel <> :tag) AND attribute_not_exists(deletedAt)'
  EAV_ARGS=(--expression-attribute-values "{\":tag\":{\"S\":\"${TARGET_MODEL}\"}}")
  echo "Scanning ${TABLE} for recipes not yet embedded with ${TARGET_MODEL} ..."
else
  FILTER='attribute_not_exists(embedding) AND attribute_not_exists(deletedAt)'
  EAV_ARGS=()
  echo "Scanning ${TABLE} for recipes without an embedding ..."
fi

# Pull recipeId/userId/title for every non-deleted recipe missing `embedding`.
# Paginate the scan so we don't miss anything beyond the 1MB page limit.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
NEXT=""
while : ; do
  if [ -n "$NEXT" ]; then
    PAGE="$(aws dynamodb scan --region "$REGION" --table-name "$TABLE" \
      --filter-expression "$FILTER" ${EAV_ARGS[@]+"${EAV_ARGS[@]}"} \
      --projection-expression 'recipeId, userId, title' \
      --starting-token "$NEXT" --output json)"
  else
    PAGE="$(aws dynamodb scan --region "$REGION" --table-name "$TABLE" \
      --filter-expression "$FILTER" ${EAV_ARGS[@]+"${EAV_ARGS[@]}"} \
      --projection-expression 'recipeId, userId, title' \
      --output json)"
  fi
  echo "$PAGE" | jq -c '.Items[]' >> "$TMP"
  NEXT="$(echo "$PAGE" | jq -r '.NextToken // empty')"
  [ -z "$NEXT" ] && break
done

COUNT="$(wc -l < "$TMP" | tr -d ' ')"
echo "Found ${COUNT} recipe(s) needing an embedding."
[ "$COUNT" -eq 0 ] && { echo "Nothing to do."; exit 0; }

N=0
while IFS= read -r item; do
  RID="$(echo "$item" | jq -r '.recipeId.S')"
  USER_ID="$(echo "$item" | jq -r '.userId.S')"
  TITLE="$(echo "$item" | jq -r '.title.S // "(untitled)"')"
  N=$((N + 1))
  if $DRY_RUN; then
    printf '  [%d/%d] would embed %s — %s\n' "$N" "$COUNT" "$RID" "$TITLE"
    continue
  fi
  printf '  [%d/%d] embedding %s — %s\n' "$N" "$COUNT" "$RID" "$TITLE"
  # Keys only — the embed-Lambda reads title/ingredients from the item when they're absent.
  PAYLOAD="$(jq -nc --arg r "$RID" --arg u "$USER_ID" '{recipeId:$r, userId:$u}')"
  aws lambda invoke --region "$REGION" --function-name "$FUNCTION" \
    --invocation-type Event \
    --cli-binary-format raw-in-base64-out \
    --payload "$PAYLOAD" /dev/null >/dev/null
done < "$TMP"

if $DRY_RUN; then
  echo "Dry run complete — no invocations made."
else
  echo "Dispatched ${COUNT} async embed invocation(s). They run in the background;"
  echo "re-run with --dry-run in a minute to confirm the count drops to 0."
fi
