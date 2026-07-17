#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/habitat-cli}"
CONFIG_DIR="$HOME/.local/share/habitat"
SYSTEMD_DIR="$HOME/.local/share/systemd/user"
DATA_DIR="$HOME/.local/share/habitat"

mkdir -p "$CONFIG_DIR" "$SYSTEMD_DIR" "$DATA_DIR"

if [[ ! -f "$CONFIG_DIR/habitat-api.env" ]]; then
  if [[ -f "$REPO_DIR/.env" ]]; then
    cp "$REPO_DIR/.env" "$CONFIG_DIR/habitat-api.env"
    echo "Copied the existing repository .env into $CONFIG_DIR/habitat-api.env."
  else
    sed "s|%h|$HOME|g" "$REPO_DIR/deploy/habitat-api.user.env.example" > "$CONFIG_DIR/habitat-api.env"
    echo "Created $CONFIG_DIR/habitat-api.env; add KEPLER_PLANET_TOKEN before starting the service."
  fi
fi

chmod 600 "$CONFIG_DIR/habitat-api.env"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$CONFIG_DIR/habitat-api.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CONFIG_DIR/habitat-api.env"
  else
    printf '%s=%s\n' "$key" "$value" >> "$CONFIG_DIR/habitat-api.env"
  fi
}

upsert_env HABITAT_API_HOST 0.0.0.0
upsert_env HABITAT_API_PORT 8787
upsert_env HABITAT_DATA_DIRECTORY "$REPO_DIR/data"

cp "$REPO_DIR/deploy/habitat-api-user.service" "$SYSTEMD_DIR/habitat-api-user.service"

systemctl --user daemon-reload
systemctl --user enable --now habitat-api-user.service
bash "$REPO_DIR/deploy/smoke-test.sh" "http://127.0.0.1:8787"
