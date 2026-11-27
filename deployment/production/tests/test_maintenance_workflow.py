"""Workflow gate semantics and executable SSH/redaction boundary without credentials."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / '.github/workflows/vm-maintenance-check.yml'
CHECK = ROOT / 'deployment/production/maintenance/check.sh'


class MaintenanceWorkflowTest(unittest.TestCase):
    def test_main_and_explicit_true_are_both_required(self):
        workflow = yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(workflow['on']['schedule'][0]['cron'], '17 6 * * *')
        self.assertIn('workflow_dispatch', workflow['on'])
        self.assertEqual(workflow['permissions'], {'contents': 'read'})
        job = workflow['jobs']['check']
        self.assertEqual(job['environment'], 'production')
        self.assertEqual(job['concurrency'], {'group': 'chalktalk-production-vm', 'cancel-in-progress': 'false'})
        expression = job['if'].replace('vars.PRODUCTION_VM_MAINTENANCE_CHECK_ENABLED', 'enabled').replace('github.ref', 'ref').replace('&&', ' and ')
        tree = ast.parse(expression, mode='eval')
        allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Compare, ast.Eq, ast.Name, ast.Load, ast.Constant)
        self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(tree)))
        for enabled in ('', 'false', 'TRUE', '1', 'true'):
            for ref in ('refs/heads/main', 'refs/heads/other', 'refs/tags/main'):
                self.assertEqual(eval(compile(tree, '<job-gate>', 'eval'), {'__builtins__': {}},
                                      {'enabled': enabled, 'ref': ref}),
                                 enabled == 'true' and ref == 'refs/heads/main')
        secrets = set()
        for step in job['steps']:
            for name, value in step.get('env', {}).items():
                if 'secrets.' in value:
                    secrets.add(name)
        self.assertEqual(secrets, {'VM_HOST', 'VM_KNOWN_HOSTS', 'SSH_PRIVATE_KEY'})

    def test_missing_and_false_opt_in_do_not_attempt_ssh_or_require_secrets(self):
        for enabled, ref in (('', 'refs/heads/main'), ('false', 'refs/heads/main'),
                             ('TRUE', 'refs/heads/main'), ('1', 'refs/heads/main'),
                             ('true', 'refs/heads/other')):
            env = {**os.environ, 'MAINTENANCE_ENABLED': enabled, 'GITHUB_REF': ref}
            for name in ('SSH_PRIVATE_KEY', 'VM_HOST', 'VM_KNOWN_HOSTS'):
                env.pop(name, None)
            result = subprocess.run(['bash', str(CHECK)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('disabled', result.stdout)

    def test_ssh_failure_and_host_output_are_sanitized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / 'ssh'
            executable.write_text('#!/bin/sh\necho "$*" > "$CALLS"\nprintf "%s" "$REPORT"\necho SECRET_MUST_NOT_ESCAPE >&2\nexit "$SSH_RESULT"\n')
            executable.chmod(0o755)
            summary = root / 'summary'
            calls = root / 'calls'
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                   'MAINTENANCE_ENABLED': 'true', 'GITHUB_REF': 'refs/heads/main',
                   'SSH_PRIVATE_KEY': 'DISPOSABLE_FAKE_KEY', 'VM_HOST': 'vm.example',
                   'VM_KNOWN_HOSTS': 'vm.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n',
                   'GITHUB_STEP_SUMMARY': str(summary), 'CALLS': str(calls), 'SSH_RESULT': '1',
                   'REPORT': json.dumps({'version': 1, 'healthy': False, 'issues': ['reboot required', 'update: stale']})}
            for report in ('SECRET_MUST_NOT_ESCAPE',
                           json.dumps({'version': 1, 'healthy': False, 'issues': ['SECRET_MUST_NOT_ESCAPE']})):
                result = subprocess.run(['bash', str(CHECK)], env={**env, 'REPORT': report}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                output = result.stdout + result.stderr + (summary.read_text() if summary.exists() else '')
                self.assertNotIn('SECRET_MUST_NOT_ESCAPE', output)
            summary.unlink()
            unhealthy = subprocess.run(['bash', str(CHECK)], env=env, capture_output=True, text=True)
            self.assertEqual(unhealthy.returncode, 1)
            written = summary.read_text()
            self.assertIn('VM maintenance: action required', written)
            self.assertIn('reboot required', written)
            self.assertIn('update: stale', written)
            self.assertNotIn('Maintenance status unavailable', written)
            summary.unlink()
            healthy_report = json.dumps({'version': 1, 'healthy': True, 'issues': []})
            failed_transport = subprocess.run(['bash', str(CHECK)], env={**env, 'REPORT': healthy_report},
                                              capture_output=True, text=True)
            self.assertEqual(failed_transport.returncode, 1)
            written = summary.read_text()
            self.assertIn('VM maintenance: action required', written)
            self.assertIn('Maintenance status unavailable', written)
            self.assertNotIn('VM maintenance: healthy', written)
            summary.unlink()
            good = subprocess.run(['bash', str(CHECK)], env={**env, 'SSH_RESULT': '0',
                                  'REPORT': healthy_report},
                                  capture_output=True, text=True)
            self.assertEqual(good.returncode, 0, good.stderr)
            command = calls.read_text()
            for option in ('StrictHostKeyChecking=yes', 'BatchMode=yes', 'ConnectTimeout=15', '-p 22'):
                self.assertIn(option, command)
            self.assertIn('sudo -n python3 /usr/local/lib/chalktalk-maintenance/status.py', command)
            self.assertNotIn('apt-get', command)
            calls.unlink()
            unpinned = subprocess.run(['bash', str(CHECK)], env={**env,
                'VM_KNOWN_HOSTS': 'other.example ssh-ed25519 AAAAFixtureOnly\n'}, capture_output=True, text=True)
            self.assertNotEqual(unpinned.returncode, 0)
            self.assertFalse(calls.exists(), 'SSH attempted with no pinned host entry')

    def test_unknown_evidence_preserves_all_reasons_without_admitting_host_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ssh = root / 'ssh'
            ssh.write_text('#!/bin/sh\nprintf "%s" "$REPORT"\nexit 1\n')
            ssh.chmod(0o755)
            summary = root / 'summary'
            reasons = ['update: unknown evidence', 'install: unknown evidence',
                       'reboot required', 'low blocks: 123']
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                   'MAINTENANCE_ENABLED': 'true', 'GITHUB_REF': 'refs/heads/main',
                   'SSH_PRIVATE_KEY': 'DISPOSABLE_FAKE_KEY', 'VM_HOST': 'vm.example',
                   'VM_KNOWN_HOSTS': 'vm.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n',
                   'GITHUB_STEP_SUMMARY': str(summary)}
            report = {'version': 1, 'healthy': False, 'issues': reasons}
            result = subprocess.run(['bash', str(CHECK)], env={**env, 'REPORT': json.dumps(report)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            written = summary.read_text()
            for reason in reasons:
                self.assertIn(reason, written)
            summary.unlink()
            report['issues'].append('raw host secret 123')
            result = subprocess.run(['bash', str(CHECK)], env={**env, 'REPORT': json.dumps(report)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            written = summary.read_text()
            self.assertNotIn('raw host secret', written)
            for reason in reasons:
                self.assertNotIn(reason, written)
            self.assertIn('Maintenance status unavailable', written)
