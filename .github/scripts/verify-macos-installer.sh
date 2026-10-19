#!/usr/bin/env bash
# Assess the app inside the actual downloadable DMG, without installing or launching it.
set -euo pipefail

dmg="${1:?Usage: verify-macos-installer.sh <dmg> <apple-team-id>}"
team="${2:?Usage: verify-macos-installer.sh <dmg> <apple-team-id>}"
if [[ ! "$team" =~ ^[A-Z0-9]{10}$ ]]; then
  echo 'Invalid Apple Developer Team ID' >&2
  exit 1
fi
if [[ ! -f "$dmg" ]]; then
  echo 'Installer DMG does not exist' >&2
  exit 1
fi

xcrun stapler validate "$dmg"
mountpoint="$(mktemp -d "${TMPDIR:-/tmp}/e6-signing-validation.XXXXXX")"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mountpoint"
  fi
  rmdir "$mountpoint"
}
trap cleanup EXIT
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mountpoint"
mounted=true

shopt -s nullglob
apps=("$mountpoint"/*.app)
if [[ ${#apps[@]} -ne 1 ]]; then
  echo 'Expected exactly one app in the installer DMG' >&2
  exit 1
fi
app="${apps[0]}"
# The Developer ID leaf OID excludes App Store, development, and ad-hoc signatures.
requirement="anchor apple generic and identifier \"com.e6tools.e6code\" and certificate leaf[subject.OU] = \"$team\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
codesign --verify --deep --strict --verbose=2 --test-requirement "$requirement" "$app"
details="$(codesign --display --verbose=4 "$app" 2>&1)"
if ! printf '%s\n' "$details" | grep -Eq '^CodeDirectory .*flags=.*\(.*runtime.*\)'; then
  echo 'App signature must enable hardened runtime' >&2
  exit 1
fi
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=4 "$app"
