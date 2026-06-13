#!/bin/bash
set -euo pipefail

SERVICE="app-store-connect"

echo "App Store Connect API key setup"
echo "================================"
echo "You'll need: Key ID, Issuer ID, and the .p8 file path."
echo ""

read -rp "Key ID (10-char, e.g. ABC1234567): " KEY_ID
read -rp "Issuer ID (UUID): " ISSUER_ID
read -rp "Path to .p8 file: " P8_PATH

P8_PATH="${P8_PATH/#\~/$HOME}"

if [[ ! -f "$P8_PATH" ]]; then
    echo "Error: file not found: $P8_PATH" >&2
    exit 1
fi

KEY_CONTENT=$(base64 -i "$P8_PATH" | tr -d '\n')

store() {
    local account="$1"
    local value="$2"
    # Delete existing entry silently, then add fresh
    security delete-generic-password -s "$SERVICE" -a "$account" 2>/dev/null || true
    security add-generic-password -s "$SERVICE" -a "$account" -w "$value"
    echo "  Stored $SERVICE / $account"
}

echo ""
echo "Storing in keychain..."
store "key-id"      "$KEY_ID"
store "issuer-id"   "$ISSUER_ID"
store "key-content" "$KEY_CONTENT"

echo ""
echo "Done. To build and upload to TestFlight:"
echo ""
echo "  cd ios && fastlane beta"
echo ""
