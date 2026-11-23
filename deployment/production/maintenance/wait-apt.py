#!/usr/bin/env python3
import errno
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time


WRAPPER = b'/usr/local/lib/chalktalk-maintenance/apt-run.sh'


def stock_service_busy(service):
    result = subprocess.run(
        ['systemctl', 'show', service, '-p', 'ActiveState', '-p', 'ControlPID', '-p', 'MainPID'],
        capture_output=True, text=True)
    if result.returncode:
        return True
    properties = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if properties.get('ActiveState') in ('inactive', 'failed'):
        return False
    try:
        pid = int(properties.get('ControlPID') or '0') or int(properties.get('MainPID') or '0')
        if pid <= 0:
            return True
        args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    except (OSError, ValueError):
        return True
    mode = b'update' if service == 'apt-daily.service' else b'install'
    return not (len(args) >= 3 and args[0].rsplit(b'/', 1)[-1] == b'bash'
                and args[1] == WRAPPER and args[2] == mode)


def main():
    deadline = time.monotonic() + float(os.environ.get('CHALKTALK_LOCK_WAIT', '600'))
    root = Path(os.environ.get('CHALKTALK_APT_LOCK_ROOT', '/'))
    paths = [root / path for path in (
        'var/lib/dpkg/lock-frontend', 'var/lib/dpkg/lock',
        'var/lib/apt/lists/lock', 'var/cache/apt/archives/lock')]
    while True:
        held = []
        try:
            busy = False
            for path in paths:
                try:
                    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
                except FileNotFoundError:
                    continue
                held.append(fd)
                try:
                    fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as error:
                    if error.errno not in (errno.EACCES, errno.EAGAIN):
                        raise
                    busy = True
                    break
            if not busy:
                for service in ('apt-daily.service', 'apt-daily-upgrade.service'):
                    if stock_service_busy(service):
                        busy = True
                        break
            if not busy:
                return 0
        finally:
            for fd in held:
                os.close(fd)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print('Timed out waiting for stock APT and native package locks', file=sys.stderr)
            return 1
        time.sleep(min(0.1, remaining))


if __name__ == '__main__':
    sys.exit(main())
