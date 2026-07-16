#!/usr/bin/env bash
set -euo pipefail

# Use the server on this machine by default; callers can override this for a remote API.
export HABITAT_API_BASE_URL="${HABITAT_API_BASE_URL:-http://127.0.0.1:8787}"
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
