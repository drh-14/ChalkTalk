"""Executable maintenance process contracts; no systemd or privilege escalation."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


class HoldControlTest(unittest.TestCase):
    def test_holds_are_root_only_persistent_and_serialized_without_interrupt(self):
        helper = '/usr/local/lib/chalktalk-maintenance/hold.sh'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'deploy.lock'
            lock.touch()
            state = root / 'state'
            env = {**os.environ, 'CHALKTALK_MAINTENANCE_STATE': str(state),
                   'CHALKTALK_DEPLOY_LOCK': str(lock), 'CHALKTALK_LOCK_WAIT': '0.15'}
            def hold(*args):
                return subprocess.run(['bash', helper, *args], env=env, capture_output=True, text=True)
            result = hold('set', 'update')
            self.assertEqual(result.returncode, 0, result.stderr)
            marker = state / 'update.hold'
            self.assertEqual(marker.stat().st_uid, 0)
            self.assertEqual(marker.stat().st_mode & 0o777, 0o644)
            self.assertEqual(hold('set', 'deployment').returncode, 0)
            self.assertEqual(hold('clear', 'deployment').returncode, 0)
            self.assertTrue(marker.exists())
            self.assertEqual(hold('clear', 'update').returncode, 0)
            child = subprocess.Popen(['flock', str(lock), 'sh', '-c', 'echo ready; sleep 1'], stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            result = hold('set', 'update')
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists())
            self.assertIsNone(child.poll(), 'hold request interrupted active transaction')
            self.assertEqual(child.wait(), 0)
            child.stdout.close()
            self.assertEqual(hold('set', 'bootstrap', 'first-token').returncode, 0)
            self.assertNotEqual(hold('set', 'bootstrap', 'second-token').returncode, 0)
            self.assertNotEqual(hold('clear', 'bootstrap', 'wrong-token').returncode, 0)
            self.assertTrue((state / 'bootstrap.hold').exists())
            self.assertEqual(hold('clear', 'bootstrap', 'first-token').returncode, 0)
            denied = subprocess.run(['runuser', '-u', 'nobody', '--', 'bash', helper, 'set', 'update'],
                                    env=env, capture_output=True, text=True)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('root', denied.stderr)


class MaintenanceRunnerTest(unittest.TestCase):
    def test_runner_checks_drift_holds_and_child_evidence_under_real_lock(self):
        helper = '/usr/local/lib/chalktalk-maintenance/apt-run.sh'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'deploy.lock'
            lock.touch()
            periodic = root / 'periodic'
            periodic.mkdir()
            state = root / 'state'
            daily = root / 'daily'
            daily.write_text('#!/bin/sh\nexec 9>&-\nflock -n "$CHALKTALK_DEPLOY_LOCK" true && exit 9\ntouch "$CHALKTALK_APT_PERIODIC/update-stamp"\n[ "$1" != install ] || touch "$CHALKTALK_APT_PERIODIC/upgrade-stamp"\n')
            daily.chmod(0o755)
            env = {**os.environ, 'CHALKTALK_MAINTENANCE_STATE': str(state),
                   'CHALKTALK_DEPLOY_LOCK': str(lock), 'CHALKTALK_APT_PERIODIC': str(periodic),
                   'CHALKTALK_APT_DAILY': str(daily), 'CHALKTALK_LOCK_WAIT': '0.15'}
            def run():
                return subprocess.run(['bash', helper, 'install'], env=env, capture_output=True, text=True)
            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            import json
            security = state / 'install.json'
            initial = json.loads(security.read_text())
            self.assertEqual(initial['disposition'], 'success')
            self.assertGreater(initial['last_success'], 0)
            child = subprocess.Popen(['flock', str(lock), 'sh', '-c', 'echo ready; sleep 1'], stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            timed_out = run()
            self.assertNotEqual(timed_out.returncode, 0)
            timed_out_evidence = json.loads(security.read_text())
            self.assertEqual(timed_out_evidence['disposition'], 'failed')
            self.assertEqual(timed_out_evidence['last_success'], initial['last_success'])
            self.assertIsNone(child.poll())
            self.assertEqual(child.wait(), 0)
            child.stdout.close()
            (state / 'update.hold').write_text('operator\n')
            self.assertEqual(run().returncode, 0)
            held = json.loads(security.read_text())
            self.assertEqual(held['disposition'], 'held')
            self.assertEqual(held['last_success'], initial['last_success'])
            (state / 'update.hold').unlink()
            daily.write_text('#!/bin/sh\necho SECRET_MUST_NOT_ESCAPE >&2\nexit 0\n')
            failed = run()
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn('SECRET_MUST_NOT_ESCAPE', failed.stdout + failed.stderr)
            evidence = json.loads(security.read_text())
            self.assertEqual(evidence['last_success'], initial['last_success'])
            self.assertEqual(evidence['disposition'], 'failed')
            drift = Path('/etc/apt/apt.conf.d/zzzz-acceptance-drift')
            drift.write_text('Unattended-Upgrade::Automatic-Reboot "true";\n')
            try:
                failed = run()
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn('policy', failed.stdout + failed.stderr)
            finally:
                drift.unlink()


class RealDeploymentLockTest(unittest.TestCase):
    def test_timeout_and_post_wait_hold_leave_releases_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shared = root / 'shared'
            shared.mkdir()
            (shared / 'production.env').write_text('DOMAIN=fixture.invalid\n')
            lock = shared / 'deploy.lock'
            lock.touch()
            state = root / 'maintenance'
            state.mkdir(mode=0o755)
            env = {**os.environ, 'CHALKTALK_DEPLOY_ROOT': str(root),
                   'CHALKTALK_MAINTENANCE_STATE': str(state), 'CHALKTALK_DEPLOY_LOCK_WAIT': '0.15'}
            child = subprocess.Popen(['flock', str(lock), 'sh', '-c', 'echo ready; sleep 1'], stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            for phase in ('stage', 'finish'):
                result = subprocess.run(['bash', '/opt/maintenance-deploy.sh', phase, 'a' * 40],
                                        env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Timed out', result.stderr)
                self.assertFalse((root / 'releases').exists())
                self.assertIsNone(child.poll())
            self.assertEqual(child.wait(), 0)
            child.stdout.close()
            child = subprocess.Popen(['flock', str(lock), 'sh', '-c', 'echo ready; sleep 1'], stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            deploy = subprocess.Popen(['bash', '/opt/maintenance-deploy.sh', 'stage', 'a' * 40],
                                      env={**env, 'CHALKTALK_DEPLOY_LOCK_WAIT': '3'},
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 0.7
            while not Path('/proc/' + str(deploy.pid) + '/fd/9').exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(Path('/proc/' + str(deploy.pid) + '/fd/9').exists())
            (state / 'deployment.hold').write_text('operator\n')
            stdout, stderr = deploy.communicate(timeout=5)
            self.assertNotEqual(deploy.returncode, 0, stdout)
            self.assertIn('Deployment hold', stderr)
            self.assertFalse((root / 'releases').exists())
            self.assertEqual(child.wait(), 0)
            child.stdout.close()


if __name__ == "__main__":
    unittest.main()
