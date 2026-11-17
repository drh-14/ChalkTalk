import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("vm_state.py")
SHA = "a" * 40
RUN_ID = "load-20261117-a1b2c3d4"
PROFILE = {"maxVus": 20, "stageMinutes": [1, 3, 3, 3], "stageTargets": [1, 5, 10, 20], "rampWriteAttempts": 17}


class VmStateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name) / "load-test"
        self.root.mkdir(mode=0o700)
        self.profile = pathlib.Path(self.temporary.name) / "profile.json"
        self.profile.write_text(json.dumps(PROFILE, separators=(",", ":")))

    def call(self, action, run_id=RUN_ID, sha=SHA, profile=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), action, "--root", str(self.root), "--run-id", run_id,
             "--deployed-sha", sha, "--profile-file", str(profile or self.profile)],
            text=True, capture_output=True,
        )

    def assert_ok(self, action, **kwargs):
        result = self.call(action, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_smoke_ramp_claims_are_atomic_one_time_and_identity_bound(self):
        self.assert_ok("claim-smoke")
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)
        state_path = self.root / (RUN_ID + ".state.json")
        self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)
        self.assert_ok("verify-smoke")
        changed = self.profile.with_name("changed.json")
        changed.write_text(json.dumps({**PROFILE, "maxVus": 10}, separators=(",", ":")))
        self.assertNotEqual(self.call("claim-ramp", profile=changed).returncode, 0)
        self.assertNotEqual(self.call("claim-ramp", sha="b" * 40).returncode, 0)
        self.assert_ok("claim-ramp")
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)
        self.assert_ok("mark-cleaned")
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)

    def test_failure_and_corrupt_state_never_reset_to_new(self):
        self.assert_ok("claim-smoke")
        self.assert_ok("mark-cleaned")
        self.assertNotEqual(self.call("verify-smoke").returncode, 0)
        state_path = self.root / (RUN_ID + ".state.json")
        state_path.write_text("corrupt")
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)

    def test_cancelled_attempt_remains_consumed_until_reviewed_cleanup(self):
        self.assert_ok("claim-smoke")
        # Model a cancelled Actions runner: no verify-smoke transition occurs.
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)
        self.assert_ok("mark-cleaned")
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)

    def test_parallel_claims_only_one_wins(self):
        args = [sys.executable, str(SCRIPT), "claim-smoke", "--root", str(self.root),
                "--run-id", RUN_ID, "--deployed-sha", SHA, "--profile-file", str(self.profile)]
        first = subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        second = subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        first.communicate(timeout=10)
        second.communicate(timeout=10)
        self.assertEqual(sorted([first.returncode, second.returncode]), [0, 1])

    def test_unsafe_root_and_stale_smoke_refuse(self):
        self.root.chmod(0o755)
        self.assertNotEqual(self.call("claim-smoke").returncode, 0)
        self.root.chmod(0o700)
        self.assert_ok("claim-smoke")
        self.assert_ok("verify-smoke")
        state_path = self.root / (RUN_ID + ".state.json")
        state = json.loads(state_path.read_text())
        state["verifiedAt"] = 1
        state_path.write_text(json.dumps(state))
        self.assertNotEqual(self.call("claim-ramp").returncode, 0)


if __name__ == "__main__":
    unittest.main()
