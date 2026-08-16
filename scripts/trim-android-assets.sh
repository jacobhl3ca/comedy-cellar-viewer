#!/usr/bin/env bash
# Strip the dead web payload out of the Android shell before bundleRelease.
#
# `npx cap sync android` copies the whole of `public/` into the app's assets.
# With `server.url` pointing at tonightnyc.com, Capacitor only ever loads a
# bundled file for `server.errorPath` — so everything else in there is weight
# the app download carries and never reads. Before this ran, the AAB shipped
# ~102 MB of the site, 98 MB of it comedian headshots in `photos/`.
#
# Run this after every `npx cap sync android` and before `./gradlew bundleRelease`.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets="$repo/android/app/src/main/assets/public"

[ -d "$assets" ] || { echo "no android assets at $assets — run npx cap sync android first" >&2; exit 1; }

# Files Capacitor's local server is expected to serve. Everything else goes.
keep=(offline.html cordova.js cordova_plugins.js)

before=$(du -sk "$assets" | cut -f1)

find "$assets" -mindepth 1 -maxdepth 1 -print0 | while IFS= read -r -d '' entry; do
  name="$(basename "$entry")"
  for k in "${keep[@]}"; do
    [ "$name" = "$k" ] && continue 2
  done
  rm -rf "$entry"
done

[ -f "$assets/offline.html" ] || { echo "offline.html missing from $assets — is it in the webDir?" >&2; exit 1; }

after=$(du -sk "$assets" | cut -f1)
echo "trimmed android assets: ${before}K -> ${after}K"
ls "$assets"
