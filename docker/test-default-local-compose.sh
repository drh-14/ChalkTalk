#!/bin/sh
set -eu

services=$(COMPOSE_ENV_FILE=.env.example docker compose config --services)
for expected in postgres seaweedfs migrate api worker collaboration web elasticsearch elasticsearch-init logstash prometheus grafana; do
  printf '%s\n' "$services" | grep -qx "$expected" || {
    echo "Missing default local service: $expected" >&2
    exit 1
  }
done
if printf '%s\n' "$services" | grep -qx seed-mock; then
  echo 'Default local stack must not auto-seed mock data' >&2
  exit 1
fi
