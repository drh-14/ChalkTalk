#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == update || "${1:-}" == install ]] || { echo 'Expected update or install' >&2; exit 2; }
maintenance_operation="$1"
source "$(dirname "$0")/common.sh"
# Do not exec: the shell retains its lock even if a child closes inherited fds.
python3 "$(dirname "$0")/run.py" "$1"
