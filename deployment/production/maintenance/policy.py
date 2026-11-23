#!/usr/bin/python3
"""Fail-closed effective APT policy verification; never changes configuration."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

RUNTIME = (r'^docker([.-].*)?$', r'^containerd([.-].*)?$', r'^runc([.-].*)?$')
FALSE_KEYS = ('Automatic-Reboot', 'Automatic-Reboot-WithUsers', 'Remove-Unused-Dependencies',
              'Remove-New-Unused-Dependencies', 'Remove-Unused-Kernel-Packages')
BASELINE = Path(os.environ.get('CHALKTALK_MAINTENANCE_STATE', '/var/lib/chalktalk-maintenance')) / 'exclusions.json'


def exclusion_baseline():
    metadata = BASELINE.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ValueError('unsafe exclusion baseline')
    data = json.loads(BASELINE.read_text(encoding='utf-8'))
    if (not isinstance(data, dict) or data.get('version') != 1
            or set(data) != {'version', 'patterns'} or not isinstance(data['patterns'], list)
            or any(not isinstance(pattern, str) for pattern in data['patterns'])):
        raise ValueError('invalid exclusion baseline')
    return data['patterns']


def capture_exclusions():
    if os.geteuid() != 0:
        raise PermissionError('root required')
    directory = BASELINE.parent.stat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or stat.S_IMODE(directory.st_mode) != 0o755:
        raise ValueError('unsafe maintenance state directory')
    if BASELINE.exists() or BASELINE.is_symlink():
        exclusion_baseline()
        return
    if Path('/etc/apt/apt.conf.d/zz-chalktalk-maintenance').exists():
        raise ValueError('existing managed policy without exclusion baseline')
    import apt_pkg
    apt_pkg.init()
    patterns = apt_pkg.config.value_list('Unattended-Upgrade::Package-Blacklist')
    descriptor, temporary = tempfile.mkstemp(prefix='.exclusions-', dir=BASELINE.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump({'version': 1, 'patterns': patterns}, output)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, BASELINE)
        handle = os.open(BASELINE.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)
    finally:
        Path(temporary).unlink(missing_ok=True)


def release():
    values = {}
    with open('/etc/os-release', encoding='utf-8') as source:
        for line in source:
            key, sep, value = line.strip().partition('=')
            if sep:
                values[key] = value.strip('"')
    if values.get('ID') != 'ubuntu' or values.get('VERSION_CODENAME') not in ('jammy', 'noble', 'resolute'):
        raise ValueError('unsupported Ubuntu release')
    return values['VERSION_CODENAME']


def check():
    import apt_pkg
    apt_pkg.init()
    issues = []
    code = release()
    expected = {f'origin=Ubuntu,archive={code}-security',
                f'origin=UbuntuESMApps,archive={code}-apps-security',
                f'origin=UbuntuESM,archive={code}-infra-security'}
    config = apt_pkg.config
    if config.value_list('Unattended-Upgrade::Allowed-Origins') or set(config.value_list('Unattended-Upgrade::Origins-Pattern')) != expected:
        issues.append('policy: unsafe security origins')
    exclusions = config.value_list('Unattended-Upgrade::Package-Blacklist')
    try:
        remaining = iter(exclusions)
        if not all(any(value == pattern for value in remaining) for pattern in exclusion_baseline()):
            issues.append('policy: missing operator exclusions')
    except (OSError, ValueError, TypeError):
        issues.append('policy: operator exclusions unavailable')
    if not set(RUNTIME).issubset(exclusions):
        issues.append('policy: missing runtime exclusions')
    try:
        for pattern in exclusions:
            re.compile(pattern)
    except re.error:
        issues.append('policy: invalid package exclusion')
    for key in FALSE_KEYS:
        if config.find('Unattended-Upgrade::' + key) != 'false':
            issues.append('policy: unsafe ' + key)
    required = {'Unattended-Upgrade::Mail': '', 'APT::Periodic::Enable': '1',
                'APT::Periodic::Update-Package-Lists': 'always',
                'APT::Periodic::Unattended-Upgrade': 'always', 'APT::Periodic::RandomSleep': '0',
                'APT::Periodic::Download-Upgradeable-Packages': '0',
                'APT::Periodic::AutocleanInterval': '0', 'APT::Periodic::CleanInterval': '0',
                'APT::Update::Error-Mode': 'any'}
    for key, expected_value in required.items():
        if config.find(key) != expected_value:
            issues.append('policy: unsafe ' + key)
    if not {'--force-confdef', '--force-confold'}.issubset(config.value_list('DPkg::Options')):
        issues.append('policy: conffile preservation missing')
    # Execute trusted root-owned Perl configuration with the same config ordering as needrestart.
    perl = r'''
our %nrconf;
my $loaded = do '/etc/needrestart/needrestart.conf';
die $@ if $@; die "config unreadable" unless defined $loaded;
for my $file (sort glob('/etc/needrestart/conf.d/*.conf')) { do $file; die $@ if $@; }
die "restart mode" unless $nrconf{restart} eq 'a';
for my $svc ('docker.service','containerd.service') {
    my $blocked = 0;
    for my $re (keys %{$nrconf{override_rc}}) {
        next unless $svc =~ /$re/;
        die "conflicting runtime override" if $nrconf{override_rc}->{$re};
        $blocked = 1;
    }
    die "runtime override absent" unless $blocked;
    for my $re (@{$nrconf{blacklist_rc} || []}) { die "hidden runtime" if $svc =~ /$re/; }
}
'''
    result = subprocess.run(['perl', '-e', perl], capture_output=True, timeout=15, check=False)
    if result.returncode:
        issues.append('policy: unsafe or unavailable needrestart configuration')
    return issues


def runtime(name):
    return any(re.match(pattern, name) for pattern in RUNTIME)


def candidates():
    """Read cached package metadata in memory only; never mark or commit changes."""
    import apt
    import apt_pkg
    cache = apt.Cache(memonly=True)
    code = release()
    origins = {('Ubuntu', code + '-security'), ('UbuntuESMApps', code + '-apps-security'),
               ('UbuntuESM', code + '-infra-security')}
    available = set()
    pending = []
    excluded = []
    patterns = [re.compile(p) for p in apt_pkg.config.value_list('Unattended-Upgrade::Package-Blacklist')]
    for package in cache:
        for version in package.versions:
            matching = {(o.origin, o.archive) for o in version.origins} & origins
            available.update(origin for origin, _ in matching)
            if not matching or not package.installed or apt_pkg.version_compare(version.version, package.installed.version) <= 0:
                continue
            target = excluded if any(pattern.match(package.name) for pattern in patterns) else pending
            target.append(package.name)
            break
    return {'pending_security': sorted(set(pending)), 'excluded_security': sorted(set(excluded)),
            'esm_available': {'apps': 'UbuntuESMApps' in available, 'infra': 'UbuntuESM' in available}}


if __name__ == '__main__':
    if sys.argv[1:] == ['capture-exclusions']:
        try:
            capture_exclusions()
        except Exception:
            print('operator exclusion baseline unavailable', file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    try:
        problems = check()
    except Exception:
        problems = ['policy: verification unavailable']
    print(json.dumps({'issues': problems}, sort_keys=True))
    sys.exit(bool(problems))
