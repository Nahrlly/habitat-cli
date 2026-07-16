#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/habitat-cli}"
SERVICE_NAME="${SERVICE_NAME:-habitat-api-user}"

cd "$DEPLOY_DIR"
git fetch --all --prune
git pull --ff-only

~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun test
~/.bun/bin/bun x tsc --noEmit

NEXT_DIST="$DEPLOY_DIR/.dist-next"
rm -rf "$NEXT_DIST"
VITE_OUT_DIR=".dist-next" ~/.bun/bin/bun run web:build
if [[ ! -f "$NEXT_DIST/index.html" ]]; then
  echo "Frontend build did not produce index.html." >&2
  exit 1
fi

PREVIOUS_DIST="$DEPLOY_DIR/.dist-previous"
rm -rf "$PREVIOUS_DIST"
if [[ -d "$DEPLOY_DIR/dist" ]]; then mv "$DEPLOY_DIR/dist" "$PREVIOUS_DIST"; fi
mv "$NEXT_DIST" "$DEPLOY_DIR/dist"

systemctl --user restart "$SERVICE_NAME"
systemctl --user is-active --quiet "$SERVICE_NAME"
curl --fail --silent --show-error http://127.0.0.1:8787/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8787/ >/dev/null
bash deploy/smoke-test.sh http://127.0.0.1:8787

echo "Habitat deployment is healthy."
