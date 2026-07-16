#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8787}"

check_status() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$BASE_URL$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$path returned HTTP $actual; expected $expected" >&2
    exit 1
  fi
}

check_status "/health" 200
check_status "/" 200

# These stateful routes are healthy when registered (200) or before registration (404).
for path in /registration /modules /power/overview /alerts; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$BASE_URL$path")"
  if [[ "$status" != "200" && "$status" != "404" ]]; then
    echo "$path returned unexpected HTTP $status" >&2
    exit 1
  fi
done

echo "Habitat smoke test passed for $BASE_URL"
