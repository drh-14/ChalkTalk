import os
import pathlib
import subprocess
import tempfile
import unittest

SHA = "a" * 40
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "guard.sh"


class CIEventGuardTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        bin_dir = pathlib.Path(self.temporary.name)
        git = bin_dir / "git"
        git.write_text("#!/bin/sh\nprintf '%s\\trefs/heads/main\\n' \"$REMOTE_SHA\"\n")
        git.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
            "CI_EVENT": "push",
            "CI_BRANCH": "main",
            "CI_CONCLUSION": "success",
            "CI_HEAD_REPOSITORY": "drh-14/ChalkTalk",
            "CI_RUN_REPOSITORY": "drh-14/ChalkTalk",
            "CI_SHA": SHA,
            "REMOTE_SHA": SHA,
        }

    def run_guard(self, **changes):
        return subprocess.run(
            ["bash", str(SCRIPT)],
            capture_output=True,
            text=True,
            env={**self.env, **changes},
        )

    def test_current_successful_main_push_passes(self):
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), SHA)

    def test_fork_pr_dispatch_failed_and_stale_are_rejected(self):
        for field, value in [
            ("CI_EVENT", "pull_request"),
            ("CI_EVENT", "workflow_dispatch"),
            ("CI_BRANCH", "feature"),
            ("CI_CONCLUSION", "failure"),
            ("CI_HEAD_REPOSITORY", "attacker/ChalkTalk"),
            ("CI_RUN_REPOSITORY", "attacker/ChalkTalk"),
            ("CI_SHA", "main"),
            ("REMOTE_SHA", "b" * 40),
        ]:
            with self.subTest(field=field, value=value):
                self.assertNotEqual(self.run_guard(**{field: value}).returncode, 0)


if __name__ == "__main__":
    unittest.main()
