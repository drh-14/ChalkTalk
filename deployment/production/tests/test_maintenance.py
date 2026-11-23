"""Public JSON/exit-code maintenance assessment contract."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

STATUS = Path(__file__).resolve().parents[1] / 'maintenance/status.py'
NOW = 2000000000


def healthy():
    return {'version': 1, 'operations': {mode: {'version': 1, 'attempt': NOW - 48 * 3600 - 20,
                                                'disposition': 'success', 'last_success': NOW - 10}
                                        for mode in ('update', 'install')},
            'holds': [], 'policy_issues': [], 'timers_healthy': True, 'dpkg_audit_clean': True,
            'reboot_required': False, 'runtime_restarts': [], 'pending_security': [],
            'excluded_security': [], 'esm_available': {'apps': False, 'infra': False},
            'detector_errors': [], 'disks': [{'filesystem': '1', 'mounts': ['/'],
                'available_bytes': 2 * 1024 ** 3, 'total_bytes': 20 * 1024 ** 3,
                'available_inodes': 10, 'total_inodes': 100}]}


class MaintenanceStatusTest(unittest.TestCase):
    def assess(self, snapshot):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'snapshot.json'
            source.write_text(json.dumps(snapshot))
            before = hashlib.sha256(source.read_bytes()).digest()
            result = subprocess.run([sys.executable, str(STATUS), '--evaluate', str(source), '--now', str(NOW)],
                                    capture_output=True, text=True)
            self.assertEqual(before, hashlib.sha256(source.read_bytes()).digest())
            self.assertNotIn('SECRET_MUST_NOT_ESCAPE', result.stdout + result.stderr)
            return result.returncode, json.loads(result.stdout)

    def test_healthy_and_exact_thresholds(self):
        snapshot = healthy()
        snapshot['operations']['update']['last_success'] = NOW - 48 * 3600
        code, result = self.assess(snapshot)
        self.assertEqual(code, 0)
        self.assertTrue(result['healthy'])
        self.assertEqual(result['issues'], [])

    def test_all_actionable_reasons_are_preserved(self):
        snapshot = healthy()
        snapshot['operations']['update']['last_success'] = NOW - 48 * 3600 - 1
        snapshot['operations']['install']['disposition'] = 'failed'
        snapshot['operations']['install']['attempt'] = NOW - 1
        snapshot.update(holds=['update'], reboot_required=True, runtime_restarts=['docker.service'],
                        pending_security=['example-package'], excluded_security=['containerd'],
                        timers_healthy=False, dpkg_audit_clean=False)
        snapshot['disks'][0].update(available_bytes=1, available_inodes=9)
        code, result = self.assess(snapshot)
        self.assertNotEqual(code, 0)
        for reason in ('update: stale', 'install: failed', 'hold: update', 'reboot required',
                       'runtime restart: docker.service', 'pending security: example-package',
                       'excluded security: containerd', 'timers unhealthy', 'package audit not clean',
                       'low blocks: 1', 'low inodes: 1'):
            self.assertIn(reason, result['issues'])

    def test_bad_evidence_is_unknown_without_disclosure(self):
        for value in (None, NOW + 1, 'SECRET_MUST_NOT_ESCAPE', False):
            with self.subTest(value=value):
                snapshot = healthy()
                snapshot['operations']['update']['last_success'] = value
                code, result = self.assess(snapshot)
                self.assertNotEqual(code, 0)
                self.assertIn('update: unknown success time', result['issues'])
        code, result = self.assess({'secret': 'SECRET_MUST_NOT_ESCAPE'})
        self.assertNotEqual(code, 0)
        self.assertIn('unknown snapshot', result['issues'])

    def test_incomplete_success_records_cannot_establish_health(self):
        for mode in ('update', 'install'):
            for field, value in (('version', None), ('attempt', None),
                                 ('attempt', NOW + 1), ('attempt', 'bad'),
                                 ('disposition', None)):
                with self.subTest(mode=mode, field=field, value=value):
                    snapshot = healthy()
                    snapshot['operations'][mode][field] = value
                    code, result = self.assess(snapshot)
                    self.assertNotEqual(code, 0)
                    self.assertIn(mode + ': unknown evidence', result['issues'])

    def test_hold_running_or_error_never_masks_stale_previous_success(self):
        for disposition in ('held', 'running', 'failed'):
            snapshot = healthy()
            snapshot['operations']['install'].update(disposition=disposition, last_success=NOW - 200000)
            code, result = self.assess(snapshot)
            self.assertNotEqual(code, 0)
            self.assertIn('install: stale', result['issues'])

    def test_running_or_held_preserves_prior_failure_with_recent_success(self):
        for disposition in ('running', 'held'):
            snapshot = healthy()
            snapshot['operations']['install'].update(
                disposition=disposition, attempt=NOW - 1,
                last_success=NOW - 100, last_failure=NOW - 50)
            snapshot['holds'] = ['update']
            snapshot['pending_security'] = ['example-package']
            code, result = self.assess(snapshot)
            self.assertNotEqual(code, 0)
            self.assertEqual(result['operations']['install']['last_failure'], NOW - 50)
            for issue in ('install: failed', 'hold: update', 'pending security: example-package'):
                self.assertIn(issue, result['issues'])
            if disposition == 'held':
                self.assertIn('install: held', result['issues'])

    def test_either_block_threshold_fails_independently(self):
        for changes in ({'available_bytes': 2 * 1024 ** 3 - 1},
                        {'total_bytes': 21 * 1024 ** 3}, {'available_inodes': 9}):
            snapshot = healthy()
            snapshot['disks'][0].update(changes)
            self.assertNotEqual(self.assess(snapshot)[0], 0)
