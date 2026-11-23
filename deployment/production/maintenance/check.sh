#!/usr/bin/env bash
set -euo pipefail
if [[ "${MAINTENANCE_ENABLED:-}" != true || "${GITHUB_REF:-}" != refs/heads/main ]]; then
  echo 'Production maintenance check disabled'
  exit 0
fi
python3 "$(dirname "$0")/check.py"
