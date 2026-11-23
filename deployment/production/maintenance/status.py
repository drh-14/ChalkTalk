#!/usr/bin/python3
"""Read-only maintenance collection and versioned JSON assessment."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

AGE = 48 * 3600
MIN_BYTES = 2 * 1024 ** 3
PACKAGE = re.compile(r'^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?$')


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def evaluate(snapshot, now):
    issues = []
    required = ('operations', 'holds', 'policy_issues', 'timers_healthy', 'dpkg_audit_clean',
                'reboot_required', 'runtime_restarts', 'pending_security', 'excluded_security',
                'esm_available', 'detector_errors', 'disks')
    if not isinstance(snapshot, dict) or snapshot.get('version') != 1 or any(key not in snapshot for key in required):
        return {'version': 1, 'healthy': False, 'issues': ['unknown snapshot']}
    operation_report = {}
    capacity_report = []
    operations = snapshot['operations']
    for mode in ('update', 'install'):
        data = operations.get(mode, {}) if isinstance(operations, dict) else {}
        if not isinstance(data, dict):
            data = {}
        attempt = data.get('attempt')
        disposition = data.get('disposition')
        success = data.get('last_success')
        valid = (type(data.get('version')) is int and data['version'] == 1
                 and number(attempt) and 0 <= attempt <= now
                 and disposition in ('success', 'running', 'held', 'failed')
                 and (success is None or number(success) and 0 <= success <= now))
        if valid:
            valid = (number(success) and attempt <= success if disposition == 'success'
                     else success is None or success <= attempt)
        if not valid:
            issues.append(mode + ': unknown evidence')
            success = None
            disposition = None
        if not number(success) or success < 0 or success > now:
            issues.append(mode + ': unknown success time')
        elif now - success > AGE:
            issues.append(mode + ': stale')
        operation_report[mode] = {'last_success': success if number(success) and 0 <= success <= now else None,
                                  'disposition': disposition if disposition in ('success', 'running', 'held', 'failed') else 'unknown'}
        if disposition in ('held', 'failed'):
            issues.append(mode + ': ' + disposition)
        elif disposition not in ('success', 'running'):
            issues.append(mode + ': unknown disposition')
    for key in ('holds', 'policy_issues', 'runtime_restarts', 'pending_security', 'excluded_security', 'detector_errors', 'disks'):
        if not isinstance(snapshot[key], list):
            issues.append('unknown ' + key)
            snapshot = {**snapshot, key: []}
    for hold in snapshot['holds']:
        issues.append('hold: ' + hold if hold in ('update', 'deployment', 'bootstrap') else 'unknown hold')
    if snapshot['policy_issues']:
        issues.append('policy unsafe or unknown')
    for key, message in (('timers_healthy', 'timers unhealthy'), ('dpkg_audit_clean', 'package audit not clean')):
        if snapshot[key] is not True:
            issues.append(message)
    if snapshot['reboot_required'] is True:
        issues.append('reboot required')
    elif snapshot['reboot_required'] is not False:
        issues.append('unknown reboot state')
    for service in snapshot['runtime_restarts']:
        issues.append('runtime restart: ' + service if service in ('docker.service', 'containerd.service') else 'unknown runtime restart')
    for key, prefix in (('pending_security', 'pending security: '), ('excluded_security', 'excluded security: ')):
        for package in snapshot[key]:
            issues.append(prefix + package if isinstance(package, str) and PACKAGE.fullmatch(package) else 'unknown security candidate')
    if snapshot['detector_errors']:
        issues.append('one or more detectors unavailable')
    disks = snapshot['disks']
    if not disks:
        issues.append('unknown filesystems')
    seen = set()
    for disk in disks:
        if not isinstance(disk, dict) or not str(disk.get('filesystem', '')).isdigit():
            issues.append('unknown filesystem')
            continue
        identifier = str(disk['filesystem'])
        if identifier in seen:
            continue
        seen.add(identifier)
        values = [disk.get(key) for key in ('available_bytes', 'total_bytes', 'available_inodes', 'total_inodes')]
        if not all(number(value) for value in values) or min(values) < 0 or values[1] <= 0 or values[3] <= 0:
            issues.append('unknown capacity: ' + identifier)
            continue
        available, total, inodes, total_inodes = values
        if available > total or inodes > total_inodes:
            issues.append('unknown capacity: ' + identifier)
            continue
        capacity_report.append({'filesystem': identifier, 'available_bytes': available, 'total_bytes': total,
                                'available_inodes': inodes, 'total_inodes': total_inodes,
                                'mounts': [mount for mount in disk.get('mounts', []) if mount in ('/', '/var', '/srv/chalktalk')]})
        if available < MIN_BYTES or available * 10 < total:
            issues.append('low blocks: ' + identifier)
        if inodes * 10 < total_inodes:
            issues.append('low inodes: ' + identifier)
    esm = snapshot['esm_available']
    if not isinstance(esm, dict) or any(type(esm.get(key)) is not bool for key in ('apps', 'infra')):
        issues.append('unknown ESM availability')
        esm = {'apps': None, 'infra': None}
    return {'version': 1, 'healthy': not issues, 'issues': sorted(set(issues)),
            'esm_available': esm, 'operations': operation_report, 'filesystems': capacity_report, 'thresholds': {'stale_seconds': AGE, 'minimum_bytes': MIN_BYTES,
                                              'minimum_blocks_percent': 10, 'minimum_inodes_percent': 10}}


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)


def collect():
    sys.dont_write_bytecode = True
    import policy
    import timer
    state = Path('/var/lib/chalktalk-maintenance')
    result = {'version': 1, 'operations': {}, 'holds': [], 'policy_issues': [],
              'timers_healthy': False, 'dpkg_audit_clean': False, 'reboot_required': None,
              'runtime_restarts': [], 'pending_security': [], 'excluded_security': [],
              'esm_available': {}, 'detector_errors': [], 'disks': []}
    def attempt(name, operation):
        try:
            operation()
        except Exception:
            result['detector_errors'].append(name)
    def operations():
        for mode in ('update', 'install'):
            try:
                path = state / (mode + '.json')
                metadata = path.stat()
                if path.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022:
                    raise ValueError('unsafe evidence')
                data = json.loads(path.read_text())
                if data.get('version') != 1:
                    raise ValueError('unknown evidence')
                result['operations'][mode] = data
            except Exception:
                result['operations'][mode] = {}
    attempt('operations', operations)
    def holds():
        result['holds'] = [name for name in ('update', 'deployment', 'bootstrap')
                           if (state / (name + '.hold')).exists() or (state / (name + '.hold')).is_symlink()]
    attempt('holds', holds)
    def policy_state():
        result['policy_issues'] = policy.check()
        result.update(policy.candidates())
    attempt('policy', policy_state)
    def timers():
        healthy = timer.check()
        for unit in ('apt-daily', 'apt-daily-upgrade'):
            enabled = command('systemctl', 'is-enabled', '--quiet', unit + '.timer')
            active = command('systemctl', 'is-active', '--quiet', unit + '.timer')
            service = command('systemctl', 'show', unit + '.service', '-p', 'Result', '--value')
            if enabled.returncode or active.returncode or service.returncode or service.stdout.strip() != 'success':
                healthy = False
        result['timers_healthy'] = healthy
    attempt('timers', timers)
    def audit():
        checked = command('dpkg', '--audit')
        result['dpkg_audit_clean'] = checked.returncode == 0 and not checked.stdout.strip() and not checked.stderr.strip()
    attempt('audit', audit)
    def reboot():
        try:
            os.stat('/var/run/reboot-required')
            result['reboot_required'] = True
        except FileNotFoundError:
            result['reboot_required'] = False
    attempt('reboot', reboot)
    def restarts():
        checked = command('needrestart', '-b', '-r', 'l')
        if checked.returncode or not re.search(r'^NEEDRESTART-VER:', checked.stdout, re.M):
            raise ValueError('restart detector unavailable')
        result['runtime_restarts'] = sorted(set(re.findall(
            r'^NEEDRESTART-SVC: (docker\.service|containerd\.service)$', checked.stdout, re.M)))
    attempt('restarts', restarts)
    def disks():
        backing = {}
        for mount in ('/', '/var', '/srv/chalktalk'):
            metadata = os.stat(mount)
            identifier = str(metadata.st_dev)
            if identifier in backing:
                backing[identifier]['mounts'].append(mount)
                continue
            capacity = os.statvfs(mount)
            backing[identifier] = {'filesystem': identifier, 'mounts': [mount],
                'available_bytes': capacity.f_bavail * capacity.f_frsize,
                'total_bytes': capacity.f_blocks * capacity.f_frsize,
                'available_inodes': capacity.f_favail, 'total_inodes': capacity.f_files}
        result['disks'] = list(backing.values())
    attempt('disks', disks)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evaluate', type=Path, help='Assess an offline JSON fixture; never collect or change host state')
    parser.add_argument('--now', type=float, help='Offline fixture clock only')
    args = parser.parse_args()
    if args.now is not None and args.evaluate is None:
        parser.error('--now requires --evaluate')
    try:
        snapshot = json.loads(args.evaluate.read_text()) if args.evaluate else collect()
        result = evaluate(snapshot, args.now if args.now is not None else time.time())
    except Exception:
        result = {'version': 1, 'healthy': False, 'issues': ['unknown snapshot']}
    print(json.dumps(result, sort_keys=True))
    return int(not result['healthy'])


if __name__ == '__main__':
    sys.exit(main())
