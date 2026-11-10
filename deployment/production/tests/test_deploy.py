import os
import pathlib
import subprocess
import tempfile
import time
import unittest

SHA = "a" * 40
OTHER = "b" * 40
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "deploy.sh"


class DeploymentScriptTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.root / "shared").mkdir()
        (self.root / "shared" / "production.env").write_text("DOMAIN=joinchalktalk.com\n")
        self.log = self.root / "calls"
        self.write_executable(
            "git",
            """#!/bin/sh
echo "$RUN_ID git $*" >> "$TEST_CALLS"
case "$*" in
  'ls-remote '* ) printf '%s\trefs/heads/main\n' "$REMOTE_SHA" ;;
  'clone '* ) for last; do :; done; mkdir -p "$last" ;;
  *'rev-parse HEAD'*) echo "$REMOTE_SHA" ;;
  *'status --porcelain'*) : ;;
esac
""",
        )
        self.write_executable(
            "docker",
            """#!/bin/sh
echo "$RUN_ID docker $*" >> "$TEST_CALLS"
case "$*" in
  *' build '* ) sleep "${SLOW_BUILD:-0}"; [ "$FAIL_BUILD" != 1 ] ;;
  *' up -d --wait'* ) [ "$FAIL_UP" != 1 ] ;;
  *'smoke.js'* ) [ "$FAIL_SMOKE" != 1 ] ;;
  *' ps -aq migrate'*) echo migration-container ;;
  *' ps -aq worker'*) echo worker-container ;;
  *' ps -aq collaboration'*) echo collab-container ;;
  *' ps' ) echo 'container status snapshot' ;;
  *'inspect'*'migration-container'*) [ "$FAIL_MIGRATION" = 1 ] && echo 'exited 1' || echo 'exited 0' ;;
  *'inspect'*'worker-container'*) [ "$FAIL_WORKER" = 1 ] && echo exited || echo running ;;
  *'inspect'*'collab-container'*) [ "$FAIL_COLLABORATION" = 1 ] && echo exited || echo running ;;
esac
""",
        )
        self.write_executable("flock", "#!/bin/sh\necho \"$RUN_ID flock $*\" >> \"$TEST_CALLS\"\npython3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX)'\n")
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "CHALKTALK_DEPLOY_ROOT": str(self.root),
            "TEST_CALLS": str(self.log),
            "REMOTE_SHA": SHA,
            "RUN_ID": "single",
        }

    def write_executable(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def run_script(self, phase, sha=SHA, **env):
        return subprocess.run(
            ["bash", str(SCRIPT), phase, sha],
            capture_output=True,
            text=True,
            env={**self.env, **env},
        )

    def calls(self):
        return self.log.read_text() if self.log.exists() else ""

    def test_exact_release_build_smoke_finish_and_repeat(self):
        result = self.run_script("stage")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(" build web api collaboration worker", self.calls())
        self.assertLess(self.calls().index("flock -x 9"), self.calls().index(" build web"))
        self.assertIn(" up -d --wait", self.calls())
        self.assertIn("apps/api/dist/deployment/smoke.js " + SHA, self.calls())
        self.assertEqual((self.root / "shared" / "pending.sha").read_text().strip(), SHA)
        self.assertEqual(self.run_script("finish").returncode, 0)
        self.assertEqual((self.root / "shared" / "deployed.sha").read_text().strip(), SHA)
        self.log.unlink()
        self.assertEqual(self.run_script("stage").returncode, 0)
        self.assertNotIn("docker", self.calls())

    def test_stale_sha_never_mutates_compose(self):
        result = self.run_script("stage", REMOTE_SHA=OTHER)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("docker", self.calls())
        self.assertFalse((self.root / "releases" / SHA).exists())

    def test_failed_build_stops_without_success_marker(self):
        result = self.run_script("stage", FAIL_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(" up -d", self.calls())
        self.assertFalse((self.root / "shared" / "pending.sha").exists())

    def test_network_drop_during_provider_smoke_leaves_release_unmarked(self):
        result = self.run_script("stage", FAIL_SMOKE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(" up -d --wait", self.calls())
        self.assertFalse((self.root / "shared" / "pending.sha").exists())
        self.assertFalse((self.root / "shared" / "deployed.sha").exists())

    def test_post_start_failures_report_phase_and_container_state(self):
        cases = (
            ("FAIL_UP", "Compose startup"),
            ("FAIL_MIGRATION", "migration check"),
            ("FAIL_WORKER", "worker check"),
            ("FAIL_COLLABORATION", "collaboration check"),
            ("FAIL_SMOKE", "provider smoke"),
        )
        for failure, phase in cases:
            with self.subTest(failure=failure):
                self.log.unlink(missing_ok=True)
                result = self.run_script("stage", **{failure: "1"})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"Release failed during {phase}", result.stderr)
                self.assertIn("container status snapshot", result.stderr)
                self.assertIn(" ps\n", self.calls())
                self.assertFalse((self.root / "shared" / "pending.sha").exists())

    def test_main_advancing_after_stage_blocks_success_marker(self):
        self.assertEqual(self.run_script("stage").returncode, 0)
        result = self.run_script("finish", REMOTE_SHA=OTHER)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "shared" / "deployed.sha").exists())

    def test_finish_requires_pending_successful_stage(self):
        result = self.run_script("finish")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "shared" / "deployed.sha").exists())

    def test_two_vm_stages_are_serialized_by_the_lock(self):
        first = subprocess.Popen(
            ["bash", str(SCRIPT), "stage", SHA],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**self.env, "RUN_ID": "first", "SLOW_BUILD": "1"},
        )
        deadline = time.monotonic() + 5
        while "first docker compose" not in self.calls() or " build " not in self.calls():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.02)
        second = subprocess.Popen(
            ["bash", str(SCRIPT), "stage", SHA],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**self.env, "RUN_ID": "second"},
        )
        time.sleep(0.15)
        self.assertNotIn("second git", self.calls())
        first.communicate(timeout=10)
        second.communicate(timeout=10)
        self.assertEqual(first.returncode, 0)
        self.assertEqual(second.returncode, 0)


if __name__ == "__main__":
    unittest.main()
