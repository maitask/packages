#!/usr/bin/env bash

# Publish official Maitask packages to a Plane package registry.
#
# Authentication:
#   TOKEN=<access-token> scripts/publish_to_plane.sh
#   PLANE_USERNAME=<user> PLANE_PASSWORD=<pass> scripts/publish_to_plane.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLANE_URL="${PLANE_URL:-http://127.0.0.1:18881}"
TOKEN="${TOKEN:-}"
PACKAGES_DIR="${PACKAGES_DIR:-$ROOT}"
PUBLISH_TMP_DIR=""

usage() {
  cat <<'EOF'
Usage: scripts/publish_to_plane.sh [package-dir...]

Publishes every package under PACKAGES_DIR when no package directories are
provided. Each package is packed with npm and uploaded through Plane's public
package publishing API, so database metadata and package tarballs stay in sync.

Env:
  PLANE_URL       Plane API URL. Default: http://127.0.0.1:18881
  TOKEN           Existing Plane access token.
  PLANE_USERNAME  Username used to request a token when TOKEN is not set.
  PLANE_PASSWORD  Password used to request a token when TOKEN is not set.
  PACKAGES_DIR    Package directory root. Default: repository root.

The script uses local npm when available. If npm is not installed but Docker is
available, it runs npm pack through node:20-alpine.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed" >&2
    exit 1
  fi
}

require_pack_runner() {
  if command -v npm >/dev/null 2>&1; then
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    return
  fi

  echo "Error: required command 'npm' is not installed and Docker fallback is unavailable" >&2
  exit 1
}

resolve_token() {
  if [[ -n "$TOKEN" ]]; then
    return
  fi

  if [[ -z "${PLANE_USERNAME:-}" || -z "${PLANE_PASSWORD:-}" ]]; then
    echo "Error: set TOKEN or PLANE_USERNAME/PLANE_PASSWORD" >&2
    exit 1
  fi

  local response
  response="$(curl -fsS -X POST "$PLANE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg u "$PLANE_USERNAME" --arg p "$PLANE_PASSWORD" \
      '{username:$u,password:$p}')")"

  TOKEN="$(printf '%s' "$response" | jq -er '.data.tokens.access_token')"
}

package_name() {
  jq -er '.name' "$1/package.json"
}

collect_package_dirs() {
  if [[ "$#" -gt 0 ]]; then
    for dir in "$@"; do
      printf '%s\0' "$dir"
    done
    return
  fi

  find "$PACKAGES_DIR" -mindepth 2 -maxdepth 2 -name package.json -print0 |
    sort -z |
    while IFS= read -r -d '' package_json; do
      printf '%s\0' "$(dirname "$package_json")"
    done
}

pack_package() {
  local pkg_dir="$1"
  local out_dir="$2"
  local pack_json

  if command -v npm >/dev/null 2>&1; then
    pack_json="$(cd "$pkg_dir" && npm pack --json --pack-destination "$out_dir")"
  else
    local pkg_abs out_abs
    pkg_abs="$(cd "$pkg_dir" && pwd)"
    out_abs="$(cd "$out_dir" && pwd)"
    pack_json="$(docker run --rm \
      -v "$pkg_abs:/pkg:ro" \
      -v "$out_abs:/out" \
      -w /pkg \
      node:20-alpine npm pack --json --pack-destination /out)"
  fi

  local filename
  filename="$(printf '%s' "$pack_json" | jq -er '.[0].filename')"
  printf '%s/%s' "$out_dir" "$filename"
}

publish_tarball() {
  local pkg_name="$1"
  local tarball="$2"
  local response_file="$3"
  local http_code

  http_code="$(curl -sS -o "$response_file" -w '%{http_code}' \
    -X POST "$PLANE_URL/packages" \
    -H "Authorization: Bearer $TOKEN" \
    -F "package=@${tarball}")"

  if [[ "$http_code" =~ ^2 ]] &&
    jq -e '.success == true' "$response_file" >/dev/null 2>&1; then
    jq -r --arg name "$pkg_name" '.data.message // ("Published " + $name)' "$response_file"
    return 0
  fi

  echo "Error: failed to publish $pkg_name (HTTP $http_code)" >&2
  jq -r 'if type == "object" then (.error.message // .error // .message // .) else . end' \
    "$response_file" >&2
  return 1
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd curl
  require_cmd jq
  require_pack_runner
  resolve_token

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  PUBLISH_TMP_DIR="$tmp_dir"
  trap 'rm -rf -- "$PUBLISH_TMP_DIR"' EXIT

  local published=0
  local failed=0
  local response_file="$tmp_dir/response.json"

  while IFS= read -r -d '' pkg_dir; do
    if [[ ! -f "$pkg_dir/package.json" ]]; then
      echo "Error: $pkg_dir/package.json not found" >&2
      failed=$((failed + 1))
      continue
    fi

    local pkg_name
    pkg_name="$(package_name "$pkg_dir")"
    echo "Publishing $pkg_name to $PLANE_URL"

    local tarball
    if tarball="$(pack_package "$pkg_dir" "$tmp_dir")" &&
      publish_tarball "$pkg_name" "$tarball" "$response_file"; then
      published=$((published + 1))
    else
      failed=$((failed + 1))
    fi
    rm -f "$response_file"
  done < <(collect_package_dirs "$@")

  echo "Publish complete: $published succeeded, $failed failed"
  if [[ "$failed" -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
