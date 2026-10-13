#!/usr/bin/env bash
# Redrive failed embeddings from the embed-Lambda's on-failure DLQ (RECIP-33).
#
# The embed-Lambda is invoked asynchronously; when an invocation exhausts its retries,
# Lambda sends an invocation record to recipator-embed-dlq-<env>. Each record's
# .requestPayload is the original event (recipeId, userId, source, ...). This script
# re-invokes the embed-Lambda with the keys only — so it re-reads the CURRENT title and
# ingredients from the table rather than replaying stale text — and deletes the message
# once the invoke has been accepted.
#
# The SQS "start-message-move-task" redrive does not apply here: that moves messages
# back to a source queue, and this DLQ has no source queue (it is a Lambda destination).
#
# Fix the underlying cause first (see docs/embed-dlq.md). A redriven recipe that fails
# again is retried by Lambda and lands back in the DLQ a few minutes later, which
# re-arms the alarm — it is never lost.
#
# Usage: AWS_PROFILE=nakom.is-sandbox ./redrive-embed-dlq.sh sandbox [--dry-run]
#        AWS_PROFILE=nakom.is-admin   ./redrive-embed-dlq.sh prod    [--dry-run]
#
#   --dry-run   show up to 10 queued failures (recipe, source, error) and change nothing;
#               the messages become visible again after 30 seconds
set -euo pipefail

ENV="${1:?usage: redrive-embed-dlq.sh <sandbox|prod> [--dry-run]}"
DRY_RUN=false
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REGION="eu-west-2"
FUNCTION="recipator-embed-${ENV}"
QUEUE_URL="$(aws sqs get-queue-url --region "$REGION" \
  --queue-name "recipator-embed-dlq-${ENV}" --query QueueUrl --output text)"

summarise() {
  jq -r '"\(.requestPayload.recipeId // "?")  user=\(.requestPayload.userId // "?")  source=\(.requestPayload.source // "unknown")  condition=\(.requestContext.condition // "?")  error=\(.responsePayload.errorMessage // "?")"'
}

if $DRY_RUN; then
  aws sqs receive-message --region "$REGION" --queue-url "$QUEUE_URL" \
    --max-number-of-messages 10 --visibility-timeout 30 --wait-time-seconds 2 \
    --output json | jq -c '.Messages // [] | .[] | .Body | fromjson' | summarise
  echo "Dry run — nothing invoked or deleted."
  exit 0
fi

N=0
while : ; do
  BATCH="$(aws sqs receive-message --region "$REGION" --queue-url "$QUEUE_URL" \
    --max-number-of-messages 10 --visibility-timeout 60 --wait-time-seconds 2 --output json)"
  [ "$(echo "$BATCH" | jq '.Messages // [] | length')" -eq 0 ] && break

  while IFS= read -r msg; do
    HANDLE="$(echo "$msg" | jq -r '.ReceiptHandle')"
    BODY="$(echo "$msg" | jq -r '.Body')"
    RID="$(echo "$BODY" | jq -r '.requestPayload.recipeId // empty')"
    USER_ID="$(echo "$BODY" | jq -r '.requestPayload.userId // empty')"
    if [ -z "$RID" ] || [ -z "$USER_ID" ]; then
      # Not replayable (malformed original payload) — leave it for a human to inspect.
      echo "  skipping message without recipeId/userId: $(echo "$BODY" | jq -c '.requestPayload')" >&2
      continue
    fi
    printf '  redriving %s\n' "$(echo "$BODY" | summarise)"
    PAYLOAD="$(jq -nc --arg r "$RID" --arg u "$USER_ID" '{recipeId:$r, userId:$u, source:"redrive"}')"
    aws lambda invoke --region "$REGION" --function-name "$FUNCTION" \
      --invocation-type Event \
      --cli-binary-format raw-in-base64-out \
      --payload "$PAYLOAD" /dev/null >/dev/null
    aws sqs delete-message --region "$REGION" --queue-url "$QUEUE_URL" --receipt-handle "$HANDLE"
    N=$((N + 1))
  done < <(echo "$BATCH" | jq -c '.Messages[]')
done

echo "Redrove ${N} failed embedding(s). The DLQ alarm returns to OK within ~10 minutes"
echo "once the queue stays empty; a recipe that fails again reappears in the DLQ."
