#!/usr/bin/env python3
"""Bounded read-only SSH check. Never print credentials or unvalidated host text."""
import html
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

ISSUE = re.compile(
    r'(?:(?:update|install): (?:unknown success time|stale|held|failed|unknown disposition)'
    r'|hold: (?:update|deployment|bootstrap)|reboot required|runtime restart: (?:docker|containerd)\.service'
    r'|(?:pending|excluded) security: [a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?'
    r'|(?:low blocks|low inodes|unknown capacity): [0-9]+'
    r'|timers unhealthy|package audit not clean|policy unsafe or unknown|one or more detectors unavailable'
    r'|unknown (?:snapshot|hold|runtime restart|security candidate|filesystems|filesystem|ESM availability'
    r'|holds|policy_issues|runtime_restarts|pending_security|excluded_security|detector_errors|disks|reboot state))')


def summarize(issues, healthy, report=None):
    destination = os.environ.get('GITHUB_STEP_SUMMARY')
    if destination:
        with open(destination, 'a', encoding='utf-8') as output:
            output.write('## VM maintenance: ' + ('healthy' if healthy else 'action required') + '\n\n')
            output.write('<pre>' + html.escape('\n'.join(issues) if issues else 'No actionable maintenance conditions') + '</pre>\n')
            output.write('Thresholds: success age >48h; available blocks <2 GiB OR <10%; available inodes <10%.\n')
            if report:
                details = {}
                operations = report.get('operations', {})
                if isinstance(operations, dict):
                    for mode in ('update', 'install'):
                        data = operations.get(mode, {})
                        value = data.get('last_success') if isinstance(data, dict) else None
                        if type(value) in (int, float) and math.isfinite(value) and value >= 0:
                            details[mode + '_last_success_utc_epoch'] = value
                capacities = []
                for disk in report.get('filesystems', []) if isinstance(report.get('filesystems'), list) else []:
                    if not isinstance(disk, dict) or not str(disk.get('filesystem', '')).isdigit():
                        continue
                    item = {'filesystem': str(disk['filesystem'])}
                    for key in ('available_bytes', 'total_bytes', 'available_inodes', 'total_inodes'):
                        value = disk.get(key)
                        if type(value) in (int, float) and math.isfinite(value) and value >= 0:
                            item[key] = value
                    capacities.append(item)
                details['filesystems'] = capacities
                output.write('<pre>' + html.escape(json.dumps(details, sort_keys=True)) + '</pre>\n')


def main():
    if os.environ.get('MAINTENANCE_ENABLED') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        print('Production maintenance check disabled')
        return 0
    try:
        host = os.environ['VM_HOST']
        if len(host) > 253 or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*', host):
            raise ValueError('host')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / 'identity'
            known = root / 'known_hosts'
            private.write_text(os.environ['SSH_PRIVATE_KEY'] + '\n')
            known.write_text(os.environ['VM_KNOWN_HOSTS'] + '\n')
            private.chmod(0o600)
            known.chmod(0o600)
            pinned = subprocess.run(['ssh-keygen', '-F', host, '-f', str(known)], stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=15, check=False)
            if pinned.returncode:
                raise ValueError('unpinned host')
            with tempfile.TemporaryFile() as response:
                checked = subprocess.run([
                    'ssh', '-T', '-p', '22', '-i', str(private), '-o', 'BatchMode=yes',
                    '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1',
                    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
                    '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'ClearAllForwardings=yes', '-o', 'UserKnownHostsFile=' + str(known),
                    'ubuntu@' + host, 'sudo -n python3 /usr/local/lib/chalktalk-maintenance/status.py'],
                    stdin=subprocess.DEVNULL, stdout=response, stderr=subprocess.DEVNULL,
                    timeout=180, check=False)
                if response.tell() > 262144:
                    raise ValueError('oversized report')
                response.seek(0)
                report = json.load(response)
            if (not isinstance(report, dict) or type(report.get('version')) is not int or report['version'] != 1
                    or type(report.get('healthy')) is not bool or not isinstance(report.get('issues'), list)
                    or len(report['issues']) > 1024):
                raise ValueError('invalid report')
            issues = report['issues']
            if any(not isinstance(issue, str) or len(issue) > 256 or not ISSUE.fullmatch(issue) for issue in issues):
                raise ValueError('untrusted report')
            if report['healthy'] != (not issues):
                raise ValueError('inconsistent report')
            summarize(issues, report['healthy'], report)
            return int(bool(checked.returncode) or not report['healthy'])
    except Exception:
        summarize(['Maintenance status unavailable; check SSH identity/connectivity and host detectors'], False)
        print('Maintenance status unavailable; no host output or credentials disclosed')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
