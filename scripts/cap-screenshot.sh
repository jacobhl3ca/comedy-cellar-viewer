#!/bin/bash
# Snap a screenshot from the booted iOS simulator and save it to screenshots-app-store/.
# Usage: ./scripts/cap-screenshot.sh dark-02-comedy-cellar
# (you navigate the app manually in the simulator first, then run this)

set -e
NAME="${1:?Usage: $0 <name-without-extension>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/screenshots-app-store/${NAME}.png"

# Refresh the status bar override so 9:41/full battery/full bars stay clean every time.
xcrun simctl status_bar booted override \
  --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState discharging --batteryLevel 100 >/dev/null 2>&1 || true

xcrun simctl io booted screenshot "$OUT"
echo "Saved: $OUT"
echo "Size: $(file "$OUT" | grep -oE '[0-9]+ x [0-9]+')"
