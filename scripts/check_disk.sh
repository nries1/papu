#!/bin/bash

THRESHOLD_GB=${1:-10}
AVAILABLE_GB=$(df / --output=avail -BG | tail -1 | tr -d 'G ')

echo "Disk space: ${AVAILABLE_GB}GB available (threshold: ${THRESHOLD_GB}GB)"

if [ "$AVAILABLE_GB" -lt "$THRESHOLD_GB" ]; then
  echo "Low disk space — pruning unused Docker images and build cache..."
  docker image prune -a -f
  docker builder prune -f
  docker volume ls -q | grep -v home_postgres_data | xargs -r docker volume rm 2>/dev/null || true

  AVAILABLE_GB=$(df / --output=avail -BG | tail -1 | tr -d 'G ')
  echo "After prune: ${AVAILABLE_GB}GB available"

  if [ "$AVAILABLE_GB" -lt "$THRESHOLD_GB" ]; then
    echo "ERROR: Still only ${AVAILABLE_GB}GB free after pruning. Aborting flash." >&2
    exit 1
  fi
fi
