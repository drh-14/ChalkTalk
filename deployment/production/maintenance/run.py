#!/usr/bin/python3
"""Run the distro daily entry point under the shell parent's host lock."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import policy
import status
import timer


def record(state, mode, disposition, started, success=None):
    destination = state / (mode + '.json')
    previous = None
    if destination.exists() and not destination.is_symlink():
        try:
            previous = json.loads(destination.read_text())
        except (ValueError, OSError):
            pass
    valid = status.valid_operation(previous, started)
    saved = previous['last_success'] if valid else None
    failure = previous['last_failure'] if valid else None
    data = {'version': 1, 'attempt': started, 'disposition': disposition,
            'last_success': success if success is not None else saved,
            'last_failure': None if disposition == 'success' else started if disposition == 'failed' else failure}
    descriptor, temporary = tempfile.mkstemp(prefix='.state-', dir=state)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(data, output, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), 0o644)
        os.replace(temporary, destination)
        directory = os.open(state, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(mode):
    if os.geteuid() != 0 or mode not in ('update', 'install'):
        return 2
    state = Path(os.environ.get('CHALKTALK_MAINTENANCE_STATE', '/var/lib/chalktalk-maintenance'))
    periodic = Path(os.environ.get('CHALKTALK_APT_PERIODIC', '/var/lib/apt/periodic'))
    daily = os.environ.get('CHALKTALK_APT_DAILY', '/usr/lib/apt/apt.systemd.daily')
    started = time.time()
    if any((state / name).exists() or (state / name).is_symlink() for name in ('update.hold', 'bootstrap.hold')):
        record(state, mode, 'held', started)
        print('maintenance held; success ages unchanged')
        return 0
    operation = mode
    try:
        if policy.check() or not timer.check():
            raise RuntimeError('policy')
        record(state, mode, 'running', started)
        # Catch-up refreshes metadata before installation, under the same held lock.
        operations = ('update', 'install') if mode == 'install' else ('update',)
        for operation in operations:
            stamp = periodic / ('update-stamp' if operation == 'update' else 'upgrade-stamp')
            before = stamp.stat().st_mtime_ns if stamp.exists() else None
            operation_started = time.time_ns()
            # No transaction runtime timeout. Do not expose child stderr/repository credentials.
            result = subprocess.run([daily, operation], stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, check=False)
            after = stamp.stat().st_mtime_ns if stamp.exists() else None
            if result.returncode or after is None or after == before or after < operation_started:
                raise RuntimeError('completion evidence')
            record(state, operation, 'success', started, time.time())
        print('maintenance completed with verified distro success stamps')
        return 0
    except Exception:
        record(state, operation, 'failed', started)
        if operation != mode:
            record(state, mode, 'failed', started)
        print('maintenance failed: policy, package operation or completion evidence unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) == 2 else ''))
