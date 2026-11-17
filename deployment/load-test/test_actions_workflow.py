import json
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "load-test.yml"
RUNNER = ROOT / "deployment" / "load-test" / "actions-run.sh"


class ActionsWorkflowTest(unittest.TestCase):
    def test_dispatch_is_main_only_environment_gated_and_never_automatic(self):
        result = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.load_file(ARGV[0]))", str(WORKFLOW)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        workflow = json.loads(result.stdout)
        triggers = workflow.get("on", workflow.get("true"))
        self.assertEqual(list(triggers), ["workflow_dispatch"])
        self.assertEqual(workflow["concurrency"]["group"], "chalktalk-production-vm")
        self.assertFalse(workflow["concurrency"]["cancel-in-progress"])
        dispatch = triggers["workflow_dispatch"]["inputs"]
        self.assertEqual(dispatch["mode"]["type"], "choice")
        self.assertEqual(dispatch["mode"]["options"], ["smoke", "ramp"])
        self.assertTrue(dispatch["run_id"]["required"])
        job = workflow["jobs"]["load-test"]
        self.assertEqual(job["environment"], "production")
        self.assertEqual(job["if"], "github.ref == 'refs/heads/main' && github.repository == 'drh-14/ChalkTalk'")
        steps = job["steps"]
        self.assertEqual([step.get("run") for step in steps if "run" in step],
                         ["bash deployment/load-test/actions-run.sh"])
        self.assertTrue(any("actions/upload-artifact@" in step.get("uses", "") for step in steps))

    def test_executable_runner_rejects_untrusted_dispatch_before_any_vm_action(self):
        base = {
            **os.environ, "GITHUB_ACTIONS": "true", "GITHUB_REF": "refs/heads/main",
            "GITHUB_REPOSITORY": "drh-14/ChalkTalk", "MODE": "smoke",
            "RUN_ID": "load-20261117-a1b2c3d4", "EXPECTED_SHA": "a" * 40,
            "GITHUB_RUN_ID": "123", "LOAD_TEST_REPORT_DIR": "/tmp/k6-dispatch-rejected",
        }
        for change in ({"GITHUB_REF": "refs/heads/feature"},
                       {"GITHUB_REPOSITORY": "other/ChalkTalk"},
                       {"GITHUB_ACTIONS": "false"}):
            with self.subTest(change=change):
                result = subprocess.run(["bash", str(RUNNER)], cwd=ROOT,
                                        env={**base, **change}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Trusted main Actions dispatch required", result.stderr)

    def test_smoke_publication_controls_vm_verification_and_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            mock = bin_dir / "mock"
            mock.write_text(textwrap.dedent("""\
                #!/usr/bin/env python3
                import json
                import os
                import pathlib
                import sys

                name = pathlib.Path(sys.argv[0]).name
                args = sys.argv[1:]
                root = pathlib.Path(os.environ["MOCK_ROOT"])
                if name == "git":
                    print(os.environ["EXPECTED_SHA"] + ("\\trefs/heads/main" if "ls-remote" in args else ""))
                elif name == "ssh":
                    command = args[-1]
                    with (root / "events").open("a") as events:
                        events.write("ssh " + command + "\\n")
                    if command == "cat /srv/chalktalk/shared/deployed.sha":
                        print(os.environ["EXPECTED_SHA"])
                    elif " inventory " in command:
                        print("{}")
                elif name == "scp":
                    if args[-1].endswith("manifest.json"):
                        pathlib.Path(args[-1]).write_text(json.dumps({"runId": os.environ["RUN_ID"]}))
                elif name == "node":
                    script = pathlib.Path(args[0]).name
                    if script == "prepare-runner.mjs":
                        target = pathlib.Path(args[1])
                        (target / "identity.json").write_text(json.dumps({"projectRef": "ref", "databaseHost": "host", "nonce": "nonce", "mac": "mac"}))
                        (target / "profile.json").write_text(json.dumps({"maxVus": 1, "stageMinutes": [1, 1, 1, 1], "rampWriteAttempts": 6}))
                    elif script == "coverage.mjs":
                        print("{}")
                    elif script == "sanitize-artifacts.mjs":
                        with (root / "events").open("a") as events:
                            events.write("sanitize\\n")
                        if os.environ.get("FAIL_SANITIZE") == "1":
                            sys.exit(1)
                        destination = pathlib.Path(args[3])
                        destination.mkdir()
                        (destination / "scope.json").write_text("{}")
                elif name == "jq":
                    if args[0] == "-r":
                        print({".projectRef": "ref", ".databaseHost": "host", ".nonce": "nonce", ".mac": "mac"}.get(args[1], "profile"))
                """))
            mock.chmod(0o755)
            for name in ("git", "ssh", "scp", "node", "jq", "docker", "curl", "sleep", "ssh-keygen"):
                (bin_dir / name).symlink_to(mock)
            env = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "MOCK_ROOT": str(root),
                "GITHUB_ACTIONS": "true",
                "GITHUB_REF": "refs/heads/main",
                "GITHUB_REPOSITORY": "drh-14/ChalkTalk",
                "GITHUB_RUN_ID": "123",
                "MODE": "smoke",
                "RUN_ID": "load-20261117-a1b2c3d4",
                "EXPECTED_SHA": "a" * 40,
                "VM_HOST": "example.invalid",
                "SSH_PRIVATE_KEY": "test-key",
                "VM_KNOWN_HOSTS": "test-host-key",
            }
            for failure in (True, False):
                with self.subTest(sanitization_fails=failure):
                    (root / "events").write_text("")
                    destination = root / "sanitized"
                    if destination.exists():
                        for child in destination.iterdir():
                            child.unlink()
                        destination.rmdir()
                    result = subprocess.run(
                        ["bash", str(RUNNER)], cwd=ROOT,
                        env={**env, "LOAD_TEST_REPORT_DIR": str(destination),
                             "FAIL_SANITIZE": "1" if failure else "0",
                             "GITHUB_STEP_SUMMARY": str(root / "summary")},
                        capture_output=True, text=True,
                    )
                    events = (root / "events").read_text().splitlines()
                    verified = [i for i, event in enumerate(events) if " verify-smoke " in event]
                    cleaned = [event for event in events if " teardown " in event]
                    if failure:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertFalse(verified)
                        self.assertTrue(cleaned)
                        self.assertFalse(destination.exists())
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertTrue((destination / "scope.json").exists())
                        self.assertEqual(len(verified), 1)
                        self.assertLess(events.index("sanitize"), verified[0])
                        self.assertFalse(cleaned)


if __name__ == "__main__":
    unittest.main()
