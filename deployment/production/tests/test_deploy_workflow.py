import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-production.yml"
SHA = "a" * 40


class DeployWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        self.calls = self.directory / "calls"
        self.write_executable("ssh-keygen", "#!/bin/sh\nexit 0\n")
        self.write_executable(
            "ssh",
            """#!/bin/sh
echo "ssh $*" >> "$TEST_CALLS"
case "$*" in
  *' compose '*' ps') echo 'container status snapshot' ;;
esac
""",
        )
        self.write_executable(
            "curl",
            """#!/bin/sh
echo "curl $*" >> "$TEST_CALLS"
if [ -n "$FAIL_HTTPS_PATH" ]; then
  case "$*" in
    *"$FAIL_HTTPS_PATH") exit 22 ;;
  esac
fi
""",
        )
        result = subprocess.run(
            [
                "ruby", "-ryaml", "-rjson", "-e",
                "steps = YAML.load_file(ARGV[0])['jobs']['deploy']['steps']; "
                "puts JSON.generate(steps.find { |step| step['name'] == 'Deploy pinned release and run provider smoke' })",
                str(WORKFLOW),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        self.step = json.loads(result.stdout)

    def write_executable(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def run_step(self, failed_url=""):
        return subprocess.run(
            ["bash", "-c", self.step["run"]],
            cwd=ROOT,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                "CI_SHA": SHA,
                "DOMAIN": "joinchalktalk.com",
                "VM_HOST": "vm.example.com",
                "VM_KNOWN_HOSTS": "pinned-host-key",
                "SSH_PRIVATE_KEY": "test-key",
                "TEST_CALLS": str(self.calls),
                "FAIL_HTTPS_PATH": failed_url,
            },
        )

    def test_external_https_failures_report_container_state(self):
        for url, phase in (
            ("https://joinchalktalk.com/", "web"),
            ("https://joinchalktalk.com/api/health", "API"),
        ):
            with self.subTest(phase=phase):
                self.calls.unlink(missing_ok=True)
                result = self.run_step(url)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"External HTTPS {phase} check failed", result.stderr)
                self.assertIn("container status snapshot", result.stderr)
                calls = self.calls.read_text()
                self.assertIn("bash -s -- stage " + SHA, calls)
                self.assertIn("COMPOSE_ENV_FILE=/srv/chalktalk/shared/production.env", calls)
                self.assertIn(" compose ", calls)
                self.assertIn(" ps\n", calls)

    def test_successful_external_https_checks_do_not_request_diagnostics(self):
        result = self.run_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls.read_text()
        self.assertIn("https://joinchalktalk.com/api/health", calls)
        self.assertNotIn(" compose ", calls)


if __name__ == "__main__":
    unittest.main()
