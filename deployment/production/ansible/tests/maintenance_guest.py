"""Real guest-only acceptance; never substitute source assertions for APT."""
import subprocess
import unittest
import os
from pathlib import Path
import time
import tempfile
import datetime
import hashlib
import json

import maintenance_repository

import apt_pkg


class EffectiveMaintenancePolicyTest(unittest.TestCase):
    def test_only_exact_security_origins_are_effectively_allowed(self):
        apt_pkg.init()
        release = subprocess.check_output(
            ["sh", "-c", ". /etc/os-release; printf %s \"$VERSION_CODENAME\""],
            text=True,
        )
        self.assertEqual(apt_pkg.config.value_list("Unattended-Upgrade::Allowed-Origins"), [])
        patterns = apt_pkg.config.value_list("Unattended-Upgrade::Origins-Pattern")
        self.assertEqual(set(patterns), {
            f"origin=Ubuntu,archive={release}-security",
            f"origin=UbuntuESMApps,archive={release}-apps-security",
            f"origin=UbuntuESM,archive={release}-infra-security",
        })

    def test_automatic_reboot_and_mail_are_disabled(self):
        apt_pkg.init()
        for key in ('Automatic-Reboot', 'Automatic-Reboot-WithUsers',
                    'Remove-Unused-Dependencies', 'Remove-New-Unused-Dependencies',
                    'Remove-Unused-Kernel-Packages'):
            with self.subTest(key=key):
                self.assertEqual(apt_pkg.config.find('Unattended-Upgrade::' + key), 'false')
        self.assertEqual(apt_pkg.config.find('Unattended-Upgrade::Mail'), '')
        self.assertIn('--force-confold', apt_pkg.config.value_list('DPkg::Options'))

    def test_effective_timer_schedule_and_periodic_configuration(self):
        apt_pkg.init()
        for name, hour in (('apt-daily', '03'), ('apt-daily-upgrade', '04')):
            def prop(key):
                return subprocess.check_output(['systemctl', 'show', name + '.timer', '-p', key, '--value'], text=True).strip()
            self.assertEqual(prop('Persistent'), 'yes')
            self.assertEqual(prop('AccuracyUSec'), '1us')
            self.assertEqual(prop('RandomizedDelayUSec'), '30min')
            calendars = prop('TimersCalendar')
            self.assertEqual(calendars.count('OnCalendar='), 1)
            self.assertIn(hour + ':00:00 UTC', calendars)
        self.assertEqual(apt_pkg.config.find('APT::Periodic::Update-Package-Lists'), 'always')
        self.assertEqual(apt_pkg.config.find('APT::Periodic::Unattended-Upgrade'), 'always')
        self.assertEqual(apt_pkg.config.find('APT::Periodic::RandomSleep'), '0')
        self.assertEqual(apt_pkg.config.find('APT::Update::Error-Mode'), 'any')


from maintenance_process import HoldControlTest, MaintenanceRunnerTest, RealDeploymentLockTest


class RealResolverSelectionTest(unittest.TestCase):
    def test_signed_origin_selection_and_runtime_exclusions(self):
        names = maintenance_repository.create()
        policy = subprocess.check_output(['apt-cache', 'policy', 'ct-sec', 'ct-third'], text=True)
        self.assertIn('Candidate: 2', policy)
        dry = subprocess.run(['unattended-upgrade', '--dry-run', '--debug'], capture_output=True, text=True)
        self.assertEqual(dry.returncode, 0, dry.stdout + dry.stderr)
        for name in names:
            self.assertEqual(subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', name], text=True), '1')
        source = Path('/etc/apt/sources.list')
        full_sources = source.read_text()
        source.write_text('\n'.join(line for line in full_sources.splitlines() if '/esm-' not in line) + '\n')
        subprocess.run(['apt-get', 'update', '--error-on=any'], check=True, stdout=subprocess.DEVNULL)
        result = subprocess.run(['unattended-upgrade', '--verbose'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'ct-sec'], text=True), '2')
        self.assertEqual(subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'ct-esm-apps'], text=True), '1')
        source.write_text(full_sources)
        subprocess.run(['apt-get', 'update', '--error-on=any'], check=True, stdout=subprocess.DEVNULL)
        result = subprocess.run(['unattended-upgrade', '--verbose'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in names:
            with self.subTest(package=name):
                expected = '2' if name in ('ct-sec', 'ct-esm-apps', 'ct-esm-infra', 'dockerish', 'containerdish', 'runcish') else '1'
                self.assertEqual(subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', name], text=True), expected)


class ServiceRestartTest(unittest.TestCase):
    def test_normal_service_restarts_but_runtime_is_detected_and_deferred(self):
        lib = Path('/usr/lib/chalktalk-acceptance.so')
        source = Path('/opt/chalktalk-acceptance.c')
        source.write_text('int fixture(void) { return 1; }')
        subprocess.run(['gcc', '-shared', '-fPIC', '-o', str(lib), str(source)], check=True)
        process = Path('/opt/chalktalk-acceptance-process.py')
        process.write_text('import ctypes,time; ctypes.CDLL("' + str(lib) + '"); time.sleep(3600)')
        services = ('chalktalk-fixture', 'docker', 'containerd')
        for service in services:
            Path('/etc/systemd/system/' + service + '.service').write_text(
                '[Service]\nType=simple\nExecStart=/usr/bin/python3 ' + str(process) + '\n')
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'start', *services], check=True)
        time.sleep(1)
        def pid(service):
            return subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', service], text=True).strip()
        before = {service: pid(service) for service in services}
        replacement = lib.with_suffix('.new')
        subprocess.run(['gcc', '-shared', '-fPIC', '-o', str(replacement), str(source)], check=True)
        os.replace(replacement, lib)
        pending = subprocess.run(['needrestart', '-b', '-r', 'l'], capture_output=True, text=True)
        self.assertEqual(pending.returncode, 0, pending.stderr)
        for service in services:
            self.assertIn('NEEDRESTART-SVC: ' + service + '.service', pending.stdout)
        restart = subprocess.run(['needrestart', '-r', 'a'], capture_output=True, text=True,
                                 env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
        self.assertEqual(restart.returncode, 0, restart.stdout + restart.stderr)
        self.assertNotEqual(pid('chalktalk-fixture'), before['chalktalk-fixture'])
        for service in ('docker', 'containerd'):
            self.assertEqual(pid(service), before[service], restart.stdout + restart.stderr)
        pending = subprocess.check_output(['needrestart', '-b', '-r', 'l'], text=True)
        self.assertIn('NEEDRESTART-SVC: docker.service', pending)
        self.assertIn('NEEDRESTART-SVC: containerd.service', pending)
        self.assertNotIn('NEEDRESTART-SVC: chalktalk-fixture.service', pending)


class TimerCatchupTest(unittest.TestCase):
    def test_real_persistent_timer_catches_missed_event(self):
        marker = Path('/opt/chalktalk-catchup')
        service = Path('/etc/systemd/system/chalktalk-catchup.service')
        service.write_text('[Service]\nType=oneshot\nExecStart=/usr/bin/touch ' + str(marker) + '\n')
        override = Path('/etc/systemd/system/apt-daily.timer.d/zz-acceptance-only.conf')
        event = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=4)).strftime('%Y-%m-%d %H:%M:%S UTC')
        override.write_text('[Timer]\nOnCalendar=\nOnCalendar=' + event +
                            '\nUnit=chalktalk-catchup.service\nRandomizedDelaySec=0\n')
        subprocess.run(['systemctl', 'stop', 'apt-daily.timer'], check=True)
        stamp = Path('/var/lib/systemd/timers/stamp-apt-daily.timer')
        stamp.touch()
        try:
            subprocess.run(['systemctl', 'daemon-reload'], check=True)
            subprocess.run(['systemctl', 'start', 'apt-daily.timer'], check=True)
            subprocess.run(['systemctl', 'stop', 'apt-daily.timer'], check=True)
            time.sleep(5)
            self.assertFalse(marker.exists())
            subprocess.run(['systemctl', 'start', 'apt-daily.timer'], check=True)
            deadline = time.monotonic() + 5
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.1)
            self.assertTrue(marker.exists(), 'persistent timer did not catch the missed calendar event')
        finally:
            subprocess.run(['systemctl', 'stop', 'apt-daily.timer'], check=True)
            override.unlink()
            subprocess.run(['systemctl', 'daemon-reload'], check=True)
            subprocess.run(['systemctl', 'start', 'apt-daily.timer'], check=True)


class VerifiedDailyEvidenceTest(unittest.TestCase):
    def test_native_apt_wait_is_bounded_without_killing_lock_owner(self):
        child = subprocess.Popen(['python3', '-c',
            'import fcntl,time; f=open("/var/lib/dpkg/lock-frontend","a"); fcntl.lockf(f,fcntl.LOCK_EX); print("ready",flush=True); time.sleep(4)'],
            stdout=subprocess.PIPE, text=True)
        self.assertEqual(child.stdout.readline().strip(), 'ready')
        before = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'ct-updates'], text=True)
        started = time.monotonic()
        result = subprocess.run(['apt-get', '-o', 'DPkg::Lock::Timeout=1', '-y', 'install', 'ct-updates'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(time.monotonic() - started, 3)
        self.assertIsNone(child.poll(), 'native timeout interrupted its lock owner')
        self.assertEqual(subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'ct-updates'], text=True), before)
        self.assertEqual(child.wait(), 0)
        child.stdout.close()

    def test_real_distro_daily_and_partial_metadata_failure(self):
        state = Path('/var/lib/chalktalk-maintenance')
        result = subprocess.run(['systemctl', 'start', 'apt-daily-upgrade.service'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for mode in ('update', 'install'):
            evidence = json.loads((state / (mode + '.json')).read_text())
            self.assertEqual(evidence['disposition'], 'success')
            self.assertGreater(evidence['last_success'], time.time() - 300)
        before = json.loads((state / 'update.json').read_text())['last_success']
        bad = Path('/etc/apt/sources.list.d/acceptance-failure.list')
        bad.write_text('deb [trusted=yes] file:/opt/absent-acceptance-repository ./\n')
        try:
            result = subprocess.run(['bash', '/usr/local/lib/chalktalk-maintenance/apt-run.sh', 'update'],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            after = json.loads((state / 'update.json').read_text())
            self.assertEqual(after['last_success'], before)
            self.assertEqual(after['disposition'], 'failed')
        finally:
            bad.unlink()


class ZZReadOnlyStatusTest(unittest.TestCase):
    def test_real_status_collects_runtime_restarts_and_makes_no_persistent_changes(self):
        paths = ('/etc/apt', '/etc/needrestart', '/var/lib/apt', '/var/lib/chalktalk-maintenance',
                 '/usr/local/lib/chalktalk-maintenance')
        def fingerprint():
            result = {}
            for root in paths:
                for path in Path(root).rglob('*'):
                    if path.is_file() and not path.is_symlink():
                        info = path.stat()
                        result[str(path)] = (info.st_mtime_ns, info.st_mode, hashlib.sha256(path.read_bytes()).hexdigest())
            return result
        before = fingerprint()
        result = subprocess.run(['python3', '/usr/local/lib/chalktalk-maintenance/status.py'],
                                capture_output=True, text=True)
        report = json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('runtime restart: docker.service', report['issues'])
        self.assertIn('runtime restart: containerd.service', report['issues'])
        self.assertIn('update: failed', report['issues'])
        self.assertEqual(before, fingerprint())


if __name__ == "__main__":
    unittest.main()
