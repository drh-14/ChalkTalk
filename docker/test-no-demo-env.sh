#!/bin/sh
set -eu

if grep -Eq 'MOCK_DATA|AMS161_DEMO_|PIAZZA_DEMO_PASSWORD' .env.example deployment/local/.env.example deployment/local/compose.yml apps/api/src/database/import-piazza.ts; then
  echo 'Public local setup and Piazza import must not use demo or mock environment variables' >&2
  exit 1
fi
