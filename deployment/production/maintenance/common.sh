#!/usr/bin/env bash
# Root-only shared state/host-lock primitives. Never time-limit a transaction.
[[ $(id -u) == 0 ]] || { echo 'Maintenance control requires root' >&2; exit 1; }
state="${CHALKTALK_MAINTENANCE_STATE:-/var/lib/chalktalk-maintenance}"
lock="${CHALKTALK_DEPLOY_LOCK:-/srv/chalktalk/shared/deploy.lock}"
wait="${CHALKTALK_LOCK_WAIT:-600}"
[[ "$state" == /* && "$lock" == /* && "$wait" =~ ^[0-9]+([.][0-9]+)?$ ]] || {
  echo 'Invalid maintenance paths or lock wait' >&2; exit 2;
}
awk -v wait="$wait" 'BEGIN { exit !(wait <= 600) }' || { echo 'Lock wait exceeds 600 seconds' >&2; exit 2; }
[[ ! -L "$state" ]] || { echo 'Unsafe maintenance state directory' >&2; exit 1; }
if [[ ! -e "$state" ]]; then install -d -o root -g root -m 0755 "$state"; fi
[[ -d "$state" && "$(stat -c '%u:%a' "$state")" == 0:755 ]] || {
  echo 'Maintenance state must be a root-owned 0755 directory' >&2; exit 1;
}
[[ -f "$lock" && ! -L "$lock" ]] || { echo 'Missing or unsafe host lock; bootstrap is required' >&2; exit 1; }
exec 9>>"$lock"
if ! flock -x -w "$wait" 9; then
  if [[ "${maintenance_operation:-}" == update || "${maintenance_operation:-}" == install ]]; then
    python3 - "$state" "$maintenance_operation" "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 <<'PY_TIMEOUT' || true
import sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[3])
from run import record
record(Path(sys.argv[1]), sys.argv[2], 'failed', time.time())
PY_TIMEOUT
  fi
  echo 'Timed out waiting for host lock; active work was not interrupted' >&2
  exit 1
fi
