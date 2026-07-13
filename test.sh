#!/usr/bin/env bash
set -euo pipefail

export HABITAT_API_BASE_URL="${HABITAT_API_BASE_URL:-http://localhost:8787}"

if ! curl --fail --silent --show-error "$HABITAT_API_BASE_URL/health" >/dev/null; then
  echo "Habitat backend is not reachable at $HABITAT_API_BASE_URL." >&2
  echo "Start it with: bun run server" >&2
  exit 1
fi

habitat() {
  bun run src/index.ts "$@"
}

echo "Starting"
habitat unregister
habitat register --name "Craziest Space Base You've Ever Seen"
habitat inventory add ferrite 90
habitat inventory add silicate-glass 45
habitat inventory add conductive-ore 18
habitat module set-status supply-cache online
habitat construct small-solar-array
habitat tick --ticks 10800
echo "Complete"
