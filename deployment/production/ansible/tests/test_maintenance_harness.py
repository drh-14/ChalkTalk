"""Acceptance runner boundary: invalid input must not start Docker."""
from pathlib import Path
import subprocess
import unittest

RUNNER = Path(__file__).with_name("maintenance-acceptance.sh")


class MaintenanceHarnessTest(unittest.TestCase):
    def test_rejects_unsupported_release_before_using_docker(self):
        result = subprocess.run(["bash", str(RUNNER), "20.04"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Expected Ubuntu 22.04, 24.04 or 26.04", result.stderr)

    def test_privileged_runner_refuses_local_execution(self):
        import os
        env = {**os.environ, 'GITHUB_ACTIONS': '', 'RUNNER_ENVIRONMENT': '', 'RUNNER_OS': ''}
        result = subprocess.run(['bash', str(RUNNER), '22.04'], env=env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('disposable GitHub-hosted Linux CI runner', result.stderr)
