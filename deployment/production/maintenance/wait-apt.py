#!/usr/bin/env python3
import errno
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time


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
                    result = subprocess.run(
                        ['systemctl', 'show', service, '-p', 'ActiveState', '--value'],
                        capture_output=True, text=True)
                    if result.returncode or result.stdout.strip() not in ('inactive', 'failed'):
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
