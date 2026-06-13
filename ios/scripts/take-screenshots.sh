#!/bin/bash
set -euo pipefail

IPHONE_ID="AE331642-31CC-4B07-8CD8-1FA1D63AC9A6"  # iPhone 17 Pro Max
IPAD_ID="3D31E62F-CF34-49A0-BEB4-03132E4E7727"     # iPad Pro 13-inch (M5)
SCHEME="Recipator (Sandbox)"
CONFIG="Debug Sandbox"
OUT="$(pwd)/screenshots"
mkdir -p "$OUT"

echo "==> Building app for simulator..."
cd "$(dirname "$0")/.."
xcodebuild \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "platform=iOS Simulator,id=$IPHONE_ID" \
  -derivedDataPath /tmp/recipator-sim-build \
  build 2>&1 | grep -E "error:|warning:|BUILD" | grep -v "warning:"

APP=$(find /tmp/recipator-sim-build -name "Recipator.app" -path "*/Debug*" | head -1)
echo "==> App built: $APP"

echo "==> Booting simulators..."
xcrun simctl boot "$IPHONE_ID" 2>/dev/null || true
xcrun simctl boot "$IPAD_ID"   2>/dev/null || true
open -a Simulator

echo "==> Installing on iPhone 17 Pro Max..."
xcrun simctl install "$IPHONE_ID" "$APP"
echo "==> Installing on iPad Pro 13-inch..."
xcrun simctl install "$IPAD_ID" "$APP"

echo ""
echo "==> Both simulators are running. Please:"
echo "    1. Log in on the iPhone simulator (it will open)"
echo "    2. Navigate to the recipe list"
echo "    3. Press Enter here when the iPhone is showing the screen you want"
echo ""
xcrun simctl launch "$IPHONE_ID" com.nakomis.recipator
read -rp "Press Enter when iPhone screenshot is ready... "

xcrun simctl io "$IPHONE_ID" screenshot "$OUT/iphone-recipe-list.png"
echo "==> iPhone screenshot saved: $OUT/iphone-recipe-list.png"

echo ""
echo "==> Now navigate to the same screen on the iPad simulator and press Enter"
xcrun simctl launch "$IPAD_ID" com.nakomis.recipator
read -rp "Press Enter when iPad screenshot is ready... "

xcrun simctl io "$IPAD_ID" screenshot "$OUT/ipad-recipe-list.png"
echo "==> iPad screenshot saved: $OUT/ipad-recipe-list.png"

echo ""
echo "Screenshots saved to: $OUT"
ls -lh "$OUT"
