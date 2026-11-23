#!/usr/bin/python3
"""Verify the effective distro maintenance timer schedule."""
import re
import subprocess
import sys


def check():
    for unit, hour in (('apt-daily.timer', '03'), ('apt-daily-upgrade.timer', '04')):
        expected = {'Persistent': 'yes', 'RandomizedDelayUSec': '30min',
                    'AccuracyUSec': '1us'}
        for key, value in expected.items():
            actual = subprocess.check_output(
                ['systemctl', 'show', unit, '-p', key, '--value'], text=True, timeout=30).strip()
            if actual != value:
                return False
        calendar = subprocess.check_output(
            ['systemctl', 'show', unit, '-p', 'TimersCalendar', '--value'],
            text=True, timeout=30)
        entries = re.findall(r'OnCalendar=([^;}]*)', calendar)
        if [entry.strip() for entry in entries] != [f'*-*-* {hour}:00:00 UTC']:
            return False
    return True


if __name__ == '__main__':
    try:
        valid = check()
    except Exception:
        valid = False
    sys.exit(0 if valid else 1)
