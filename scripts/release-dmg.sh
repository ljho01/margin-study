#!/bin/zsh
# Builds a Developer ID signed, notarized, stapled DMG, and the signed updater
# archive plus latest.json when an updater key is given. Runs locally and in
# GitHub Actions (.github/workflows/release.yml).
#
#   MARGIN_SIGNING_IDENTITY  default: Arky Korea Developer ID
#   Notarization, either:
#     NOTARY_KEY_PATH, NOTARY_KEY_ID, NOTARY_ISSUER  App Store Connect API key (CI)
#     MARGIN_NOTARY_PROFILE  notarytool keychain profile, default arky-notary (local)
#   Updater (optional):
#     UPDATER_PRIVATE_KEY, UPDATER_PRIVATE_KEY_PASSWORD  minisign key from `tauri signer generate`
#     RELEASE_BASE_URL  download URL prefix written into latest.json
set -euo pipefail

cd "${0:A:h}/.."
identity=${MARGIN_SIGNING_IDENTITY:-"Developer ID Application: Arky Korea Inc. (WZ3H5LP87N)"}
profile=${MARGIN_NOTARY_PROFILE:-arky-notary}
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
arch=aarch64
name="여백"
# Release asset names stay ASCII so download URLs need no escaping.
asset="Yeobaek"
out="output/release"
work=$(mktemp -d)
# Values left over from other Tauri projects must not leak into this build.
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD

notarize() {
  if [[ -n ${NOTARY_KEY_PATH:-} ]]; then
    xcrun notarytool submit "$1" --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" --wait
  else
    xcrun notarytool submit "$1" --keychain-profile "$profile" --wait
  fi
}

echo "==> build $version"
APPLE_SIGNING_IDENTITY="$identity" bunx tauri build --bundles app
app="src-tauri/target/release/bundle/macos/$name.app"

echo "==> sign"
for bin in "$app"/Contents/Resources/bin/*; do
  entitlements=()
  [[ $bin == */codex* ]] && entitlements=(--entitlements scripts/codex.entitlements)
  codesign --force --options runtime --timestamp $entitlements --sign "$identity" "$bin"
done
codesign --force --options runtime --timestamp --sign "$identity" "$app"
codesign --verify --deep --strict "$app"

echo "==> notarize app"
ditto -c -k --keepParent "$app" "$work/app.zip"
notarize "$work/app.zip"
xcrun stapler staple "$app"

mkdir -p "$out"
for previous in "$out"/*(N); do mv "$previous" "$work/"; done

if [[ -n ${UPDATER_PRIVATE_KEY:-} ]]; then
  echo "==> updater"
  archive="$out/${asset}_${arch}.app.tar.gz"
  tar -czf "$archive" -C "${app:h}" "${app:t}"
  bunx tauri signer sign -k "$UPDATER_PRIVATE_KEY" -p "${UPDATER_PRIVATE_KEY_PASSWORD:-}" --app-version "$version" "$archive"
  if [[ -n ${RELEASE_BASE_URL:-} ]]; then
    node -e '
      const [version, url, sig] = process.argv.slice(1);
      const fs = require("fs");
      fs.writeFileSync(process.argv[4], JSON.stringify({
        version,
        pub_date: new Date().toISOString(),
        platforms: { "darwin-aarch64": { url, signature: fs.readFileSync(sig, "utf8").trim() } },
      }, null, 2) + "\n");
    ' "$version" "$RELEASE_BASE_URL/${archive:t}" "$archive.sig" "$out/latest.json"
  fi
fi

echo "==> dmg"
mkdir -p "$work/dmg"
dmg="$out/${asset}_${version}_${arch}.dmg"
ditto "$app" "$work/dmg/$name.app"
ln -s /Applications "$work/dmg/Applications"
hdiutil create -volname "$name" -srcfolder "$work/dmg" -ov -format UDZO "$dmg"
codesign --force --timestamp --sign "$identity" "$dmg"

echo "==> notarize dmg"
notarize "$dmg"
xcrun stapler staple "$dmg"
spctl -a -t open --context context:primary-signature -vv "$dmg"

ditto -c -k --keepParent "$dmg" "$dmg.zip"
shasum -a 256 "$out"/*
