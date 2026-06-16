#!/usr/bin/env bash
# Set a group member's avatar (RECP-51) by uploading it to the recipator-avatars bucket.
#
# Avatars live at the convention key avatars/{userId}.jpg — GET /config presigns a
# download URL for any member who has one. Use this for members who haven't set their own
# from the app (e.g. Yvonne). The image is normalised to JPEG before upload.
#
# Usage: AWS_PROFILE=nakom.is-sandbox ./set-member-avatar.sh sandbox <userId> <imagePath>
#        AWS_PROFILE=nakom.is-admin   ./set-member-avatar.sh prod    <userId> <imagePath>
#
# Tip — find a member's userId from the group-members SSM parameter:
#   aws ssm get-parameter --name /recipator/<env>/group-members \
#       --query Parameter.Value --output text | jq .
set -euo pipefail

ENV="${1:?usage: set-member-avatar.sh <sandbox|prod> <userId> <imagePath>}"
USER_ID="${2:?missing <userId>}"
IMAGE="${3:?missing <imagePath>}"
REGION="eu-west-2"
BUCKET="recipator-avatars-${ENV}"
KEY="avatars/${USER_ID}.jpg"

[ -f "$IMAGE" ] || { echo "❌ image not found: $IMAGE"; exit 1; }

TMP="$(mktemp -d)"
JPG="${TMP}/avatar.jpg"
# Normalise to a square-ish JPEG, max 512px, so the stored avatar is small and a
# predictable content type. `sips` ships with macOS.
cp "$IMAGE" "$JPG"
sips -s format jpeg -Z 512 "$JPG" >/dev/null

echo "Uploading $IMAGE -> s3://${BUCKET}/${KEY} ..."
aws s3 cp "$JPG" "s3://${BUCKET}/${KEY}" --region "$REGION" --content-type image/jpeg

rm -rf "$TMP"
echo "✓ set avatar for ${USER_ID} in ${ENV}"
