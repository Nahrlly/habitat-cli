#!/usr/bin/env bash
set -euo pipefail

# Use the persistent Habitat server by default; callers can override this for another API.
export HABITAT_API_BASE_URL="${HABITAT_API_BASE_URL:-http://100.127.123.108:8787}"
export HABITAT_REMOTE_MODE=1

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
