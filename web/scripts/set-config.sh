#!/bin/bash

# Populates src/config/config.json from AWS SSM before build.
# Usage: set-config.sh [sandbox|prod|localhost]

set -euo pipefail

PARAM=$1
ENV="${PARAM:=sandbox}"

if [[ $ENV == "localhost" ]]; then
  export AWS_ENV=sandbox
else
  export AWS_ENV=$ENV
fi

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"

# Only set AWS_PROFILE when no credential env vars are present (i.e. local dev).
# In CI, configure-aws-credentials sets AWS_ACCESS_KEY_ID etc. directly and
# AWS_PROFILE would override them with a nonexistent local profile.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_PROFILE=nakom.is-$AWS_ENV
fi

CONFIG_FILE="$SCRIPT_DIR/../src/config/config.json"

function setValue() {
  local key="$1"
  local value="$2"
  echo "Setting $key to $value"
  local tmp
  tmp=$(mktemp)
  sed "s|\"$key\": \".*\"|\"$key\": \"$value\"|g" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
}

cp "$SCRIPT_DIR/../src/config/config.json.template" "$CONFIG_FILE"

echo "Setting env to $ENV"
setValue env "$ENV"

# aws configure get region only reads the config file, not AWS_DEFAULT_REGION.
# Prefer the env var (set by configure-aws-credentials in CI), fall back to config file.
REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-$(aws configure get region)}}"
setValue region "$REGION"

# The user pool and login domain are shared across nakomis projects (nakomis-infra);
# the app client id and API URL are published by Recipator's own stacks.
USER_POOL_ID=$(aws ssm get-parameter --name "/nakomis-infra/${AWS_ENV}/cognito/user-pool-id" --query "Parameter.Value" --output text)
setValue authority "https://cognito-idp.eu-west-2.amazonaws.com/${USER_POOL_ID}"
setValue userPoolId "$USER_POOL_ID"

USER_POOL_CLIENT_ID=$(aws ssm get-parameter --name "/recipator/${AWS_ENV}/cognito/client-id" --query "Parameter.Value" --output text)
setValue userPoolClientId "$USER_POOL_CLIENT_ID"

LOGIN_DOMAIN=$(aws ssm get-parameter --name "/nakomis-infra/${AWS_ENV}/cognito/login-domain" --query "Parameter.Value" --output text)
setValue cognitoDomain "$LOGIN_DOMAIN"

case $ENV in
  prod)
    setValue redirectUri "https://recipator.nakomis.com/loggedin"
    setValue logoutUri "https://recipator.nakomis.com/logout"
    ;;
  sandbox)
    setValue redirectUri "https://recipator.sandbox.nakomis.com/loggedin"
    setValue logoutUri "https://recipator.sandbox.nakomis.com/logout"
    ;;
  localhost)
    setValue redirectUri "http://localhost:3000/loggedin"
    setValue logoutUri "http://localhost:3000/logout"
    ;;
  *)
    echo "Unknown environment: $ENV"
    exit 1
    ;;
esac

API_URL=$(aws ssm get-parameter --name "/recipator/${AWS_ENV}/api/url" --query "Parameter.Value" --output text 2>/dev/null || echo "")
setValue apiUrl "$API_URL"
