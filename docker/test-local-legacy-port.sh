#!/bin/sh
set -eu

directory=$(mktemp -d "$PWD/.compose-port-test-XXXXXX")
project="chalktalk-port-smoke-${GITHUB_RUN_ID:-local}-$$"
env_file="$directory/local.env"
export COMPOSE_ENV_FILE="${env_file#"$PWD"/}"

cat > "$directory/ports.yml" <<'EOF'
services:
  postgres:
    ports: !reset []
  seaweedfs:
    ports: !reset []
EOF

compose() {
  docker compose -p "$project" \
    -f deployment/local/compose.yml -f "$directory/ports.yml" \
    --env-file "$env_file" "$@"
}

trap 'compose down --volumes --remove-orphans >/dev/null 2>&1 || true; rm -rf "$directory"' EXIT

cp deployment/local/.env.example "$env_file"
printf '\nPORT=3002\n' >> "$env_file"
if compose up --build --wait --wait-timeout 120 api worker > "$directory/legacy.log" 2>&1; then
  echo 'Local Compose startup unexpectedly accepted PORT=3002' >&2
  exit 1
fi
compose logs --no-color migrate > "$directory/migrate.log"
if ! grep -Fq 'remove PORT from .env' "$directory/migrate.log"; then
  cat "$directory/legacy.log" >&2
  cat "$directory/migrate.log" >&2
  exit 1
fi
if compose ps --services --status running | grep -Eq '^(api|worker)$'; then
  echo 'API or worker started before migration preflight completed' >&2
  exit 1
fi

compose down --volumes --remove-orphans >/dev/null
cp deployment/local/.env.example "$env_file"
if ! compose up --build --abort-on-container-exit --exit-code-from migrate migrate > "$directory/current.log" 2>&1; then
  cat "$directory/current.log" >&2
  exit 1
fi
