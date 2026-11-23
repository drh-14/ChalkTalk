#!/usr/bin/env bash
set -euo pipefail
operation="${1:-}"
kind="${2:-}"
token="${3:-operator}"
[[ "$operation" == set || "$operation" == clear ]] || { echo 'Expected set or clear' >&2; exit 2; }
[[ "$kind" == update || "$kind" == deployment || "$kind" == bootstrap ]] || { echo 'Invalid hold kind' >&2; exit 2; }
[[ "$token" =~ ^[a-zA-Z0-9-]{1,128}$ ]] || { echo 'Invalid hold token' >&2; exit 2; }
if [[ "$kind" == bootstrap && $# != 3 ]]; then echo 'Bootstrap hold requires its invocation token' >&2; exit 2; fi
source "$(dirname "$0")/common.sh"
marker="$state/$kind.hold"
[[ ! -L "$marker" ]] || { echo 'Unsafe hold marker' >&2; exit 1; }
if [[ "$operation" == set ]]; then
  if [[ -e "$marker" ]]; then
    [[ "$kind" != bootstrap ]] || { echo 'Previous bootstrap hold requires explicit recovery' >&2; exit 1; }
    echo "$kind hold already present"
    exit 0
  fi
  python3 - "$marker" "$token" <<'PY_HOLD'
import os
from pathlib import Path
import sys
import tempfile
marker, token = Path(sys.argv[1]), sys.argv[2]
fd, temporary = tempfile.mkstemp(prefix='.hold-', dir=marker.parent)
try:
    with os.fdopen(fd, 'w') as output:
        output.write(token + '\n')
        output.flush()
        os.fchmod(output.fileno(), 0o644)
        os.fsync(output.fileno())
    os.replace(temporary, marker)
    directory = os.open(marker.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
finally:
    Path(temporary).unlink(missing_ok=True)
PY_HOLD
else
  if [[ -e "$marker" ]]; then
    [[ "$(stat -c %u "$marker")" == 0 ]] || { echo 'Unsafe hold ownership' >&2; exit 1; }
    if [[ "$kind" == bootstrap && "$(cat "$marker")" != "$token" ]]; then
      echo 'Bootstrap hold token mismatch; previous hold retained' >&2; exit 1
    fi
    unlink "$marker"
  fi
fi
echo "$kind hold $operation completed"
