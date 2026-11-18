import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = {
    "smoke": ROOT / ".github" / "workflows" / "load-test-smoke.yml",
    "ramp": ROOT / ".github" / "workflows" / "load-test-ramp.yml",
}
RUNNER = ROOT / "deployment" / "load-test" / "actions-run.sh"


class ActionsWorkflowTest(unittest.TestCase):
    def test_manual_dispatches_are_main_only_environment_gated_and_never_automatic(self):
        self.assertFalse((ROOT / ".github" / "workflows" / "load-test.yml").exists())
        for mode, path in WORKFLOWS.items():
            with self.subTest(mode=mode):
                result = subprocess.run(
                    ["ruby", "-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.load_file(ARGV[0]))", str(path)],
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                workflow = json.loads(result.stdout)
                triggers = workflow.get("on", workflow.get("true"))
                self.assertEqual(list(triggers), ["workflow_dispatch"])
                if mode == "smoke":
                    self.assertFalse(triggers["workflow_dispatch"] and triggers["workflow_dispatch"].get("inputs"))
                else:
                    self.assertEqual(list(triggers["workflow_dispatch"]["inputs"]), ["max_concurrent_users"])
                    self.assertTrue(triggers["workflow_dispatch"]["inputs"]["max_concurrent_users"]["required"])
                self.assertEqual(workflow["concurrency"]["group"], "chalktalk-production-vm")
                self.assertFalse(workflow["concurrency"]["cancel-in-progress"])
                job = workflow["jobs"]["load-test"]
                self.assertEqual(job["environment"], "production")
                self.assertEqual(job["if"], "github.ref == 'refs/heads/main' && github.repository == 'drh-14/ChalkTalk'")
                steps = job["steps"]
                self.assertEqual([step.get("run") for step in steps if "run" in step],
                                 ["bash deployment/load-test/actions-run.sh"])
                runner_env = steps[1]["env"]
                self.assertEqual(runner_env["MODE"], mode)
                self.assertNotIn("RUN_ID", runner_env)
                self.assertEqual("MAX_CONCURRENT_USERS" in runner_env, mode == "ramp")
                self.assertFalse(any(key.startswith("LOAD_TEST_") and key != "LOAD_TEST_REPORT_DIR" for key in runner_env))
                self.assertEqual(runner_env["GITHUB_RUN_ATTEMPT"], "${{ github.run_attempt }}")
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
                import hashlib
                import os
                import pathlib
                import sys

                name = pathlib.Path(sys.argv[0]).name
                args = sys.argv[1:]
                root = pathlib.Path(os.environ["MOCK_ROOT"])
                if name == "timeout":
                    os.execvp(args[1], args[1:])
                elif name == "git":
                    print(os.environ["EXPECTED_SHA"] + ("\\trefs/heads/main" if "ls-remote" in args else ""))
                elif name == "ssh":
                    command = args[-1]
                    with (root / "events").open("a") as events:
                        events.write("ssh " + command + "\\n")
                    if command == "cat /srv/chalktalk/shared/deployed.sha":
                        print(os.environ["EXPECTED_SHA"])
                    elif " claim-smoke-auto " in command or " claim-ramp-auto " in command:
                        print(json.dumps({"runId": os.environ["MOCK_RUN_ID"],
                                          "sourceRunUrl": os.environ["MOCK_SOURCE_URL"],
                                          "status": "smoke-claimed" if " claim-smoke-auto " in command else "ramp-claimed"}))
                    elif " inventory " in command:
                        counter = root / "inventory-count"
                        number = int(counter.read_text()) + 1 if counter.exists() else 1
                        counter.write_text(str(number))
                        if (os.environ.get("FAIL_CLEANUP") == "retry" and number == 2) or (os.environ.get("FAIL_CLEANUP") == "exhausted" and number >= 2):
                            print("CONNECTION_ACQUISITION_EXHAUSTED", file=sys.stderr)
                            sys.exit(1)
                        changed = os.environ.get("FAIL_CLEANUP")
                        posts = 3 if number == 3 and changed == "changed-count" else 2
                        job_id = "job-2" if number == 3 and changed == "changed-job" else "job-1"
                        print(json.dumps({"counts": {"organizations": 1, "courses": 1, "users": 20,
                                                     "posts": posts, "jobs": 1},
                                          "violations": [], "jobIds": [job_id]}))
                    elif " teardown " in command and os.environ.get("FAIL_CLEANUP") in ("changed-count", "changed-job"):
                        counter = root / "teardown-count"
                        number = int(counter.read_text()) + 1 if counter.exists() else 1
                        counter.write_text(str(number))
                        if number == 1:
                            print("CONNECTION_ACQUISITION_EXHAUSTED", file=sys.stderr)
                            sys.exit(1)
                    elif " teardown " in command and os.environ.get("FAIL_CLEANUP") == "ambiguous":
                        print("Ambiguous transaction outcome", file=sys.stderr)
                        sys.exit(1)
                    elif " verify-fixture " in command:
                        manifest = json.dumps({"runId": os.environ["MOCK_RUN_ID"]}).encode()
                        print(json.dumps({"verifiedManifestSha256": hashlib.sha256(manifest).hexdigest()}))
                elif name == "scp":
                    if args[-1].endswith("manifest.json"):
                        pathlib.Path(args[-1]).write_text(json.dumps({"runId": os.environ["MOCK_RUN_ID"]}))
                elif name == "node":
                    script = pathlib.Path(args[0]).name
                    if script == "verify-inventory.mjs":
                        os.execv(os.environ["MOCK_NODE"], [os.environ["MOCK_NODE"], *args])
                    elif script == "prepare-runner.mjs":
                        target = pathlib.Path(args[1])
                        (target / "identity.json").write_text(json.dumps({"projectRef": "ref", "databaseHost": "host", "nonce": "nonce", "mac": "mac"}))
                        (target / "profile.json").write_text(json.dumps({"maxVus": 1, "stageMinutes": [1, 1, 1, 1], "rampWriteAttempts": 6}))
                    elif script == "coverage.mjs":
                        print("{}")
                    elif script == "preflight.mjs":
                        with (root / "events").open("a") as events:
                            events.write("preflight " + args[1] + "\\n")
                        if args[1] == "ready" and os.environ.get("FAIL_PREFLIGHT") == "1":
                            sys.exit(1)
                    elif script == "sanitize-artifacts.mjs":
                        with (root / "events").open("a") as events:
                            events.write("sanitize\\n")
                        if os.environ.get("FAIL_SANITIZE") == "1":
                            sys.exit(1)
                        destination = pathlib.Path(args[3])
                        destination.mkdir()
                        (destination / "scope.json").write_text("{}")
                elif name == "jq":
                    if args[0] in ("-r", "-er"):
                        print({".projectRef": "ref", ".databaseHost": "host", ".nonce": "nonce", ".mac": "mac",
                               ".runId": os.environ["MOCK_RUN_ID"], ".sourceRunUrl": os.environ["MOCK_SOURCE_URL"],
                               ".verifiedManifestSha256": hashlib.sha256(json.dumps({"runId": os.environ["MOCK_RUN_ID"]}).encode()).hexdigest()}.get(args[1], "profile"))
                """))
            mock.chmod(0o755)
            for name in ("git", "ssh", "scp", "node", "jq", "docker", "curl", "sleep", "timeout", "ssh-keygen"):
                (bin_dir / name).symlink_to(mock)
            env = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "MOCK_ROOT": str(root),
                "MOCK_NODE": shutil.which("node"),
                "GITHUB_ACTIONS": "true",
                "GITHUB_REF": "refs/heads/main",
                "GITHUB_REPOSITORY": "drh-14/ChalkTalk",
                "GITHUB_RUN_ID": "123456789",
                "GITHUB_RUN_ATTEMPT": "1",
                "MODE": "smoke",
                "MOCK_RUN_ID": "load-20261117-gh123456789",
                "MOCK_SOURCE_URL": "https://github.com/drh-14/ChalkTalk/actions/runs/123456789",
                "EXPECTED_SHA": "a" * 40,
                "VM_HOST": "example.invalid",
                "SSH_PRIVATE_KEY": "test-key",
                "VM_KNOWN_HOSTS": "test-host-key",
            }
            for failure in ("preflight", "sanitization", "retry", "exhausted", "ambiguous", "changed-count", "changed-job", None):
                with self.subTest(failure=failure):
                    (root / "events").write_text("")
                    (root / "inventory-count").unlink(missing_ok=True)
                    (root / "teardown-count").unlink(missing_ok=True)
                    destination = root / "sanitized"
                    if destination.exists():
                        for child in destination.iterdir():
                            child.unlink()
                        destination.rmdir()
                    result = subprocess.run(
                        ["bash", str(RUNNER)], cwd=ROOT,
                        env={**env, "LOAD_TEST_REPORT_DIR": str(destination),
                             "FAIL_PREFLIGHT": "1" if failure == "preflight" else "0",
                             "FAIL_SANITIZE": "1" if failure == "sanitization" else "0",
                             "FAIL_CLEANUP": failure if failure in ("retry", "exhausted", "ambiguous", "changed-count", "changed-job") else "",
                             "GITHUB_STEP_SUMMARY": str(root / "summary")},
                        capture_output=True, text=True,
                    )
                    events = (root / "events").read_text().splitlines()
                    verified = [i for i, event in enumerate(events) if " verify-fixture " in event]
                    cleaned = [event for event in events if " teardown " in event]
                    if failure == "preflight":
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("preflight ready", events)
                        self.assertFalse(any(" vm_control.py prepare " in event for event in events))
                        self.assertFalse(any(" claim-smoke-auto " in event for event in events))
                        self.assertFalse(any(" provision " in event for event in events))
                        self.assertFalse(cleaned)
                    elif failure == "sanitization":
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(len(verified), 1)
                        self.assertTrue(cleaned)
                        self.assertFalse(destination.exists())
                    elif failure == "ambiguous":
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(len(cleaned), 1)
                        self.assertFalse(any(" mark-cleaned " in event for event in events))
                    elif failure == "retry":
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(len(cleaned), 1)
                        self.assertEqual(int((root / "inventory-count").read_text()), 3)
                        self.assertTrue(any(" mark-cleaned " in event for event in events))
                    elif failure == "exhausted":
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(int((root / "inventory-count").read_text()), 4)
                        self.assertFalse(cleaned)
                        self.assertFalse(any(" mark-cleaned " in event for event in events))
                    elif failure in ("changed-count", "changed-job"):
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(int((root / "inventory-count").read_text()), 3)
                        self.assertEqual(len(cleaned), 1)
                        self.assertFalse(any(" mark-cleaned " in event for event in events))
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertTrue((destination / "scope.json").exists())
                        self.assertEqual(len(verified), 1)
                        self.assertTrue(cleaned)
                        self.assertLess(verified[0], events.index("sanitize"))
                        self.assertLess(events.index("preflight ready"),
                                        next(i for i, event in enumerate(events) if " claim-smoke-auto " in event))
                        self.assertFalse(any("vm_control.py check " in event for event in events))
                        summary = (root / "summary").read_text()
                        self.assertIn(env["MOCK_RUN_ID"], summary)
                        self.assertIn(env["MOCK_SOURCE_URL"], summary)

            (root / "events").write_text("")
            for child in destination.iterdir():
                child.unlink()
            destination.rmdir()
            ramp = subprocess.run(
                ["bash", str(RUNNER)], cwd=ROOT,
                env={**env, "MODE": "ramp", "LOAD_TEST_REPORT_DIR": str(destination),
                     "FAIL_PREFLIGHT": "0", "FAIL_SANITIZE": "0",
                     "GITHUB_STEP_SUMMARY": str(root / "summary")},
                capture_output=True, text=True,
            )
            events = (root / "events").read_text().splitlines()
            self.assertEqual(ramp.returncode, 0, ramp.stderr)
            self.assertTrue(any(" claim-ramp-auto " in event for event in events))
            self.assertFalse(any(" claim-smoke-auto " in event for event in events))
            self.assertFalse(any("vm_control.py check " in event for event in events))
            self.assertTrue(any(" teardown " in event for event in events))
            self.assertTrue(any(" provision " in event for event in events))
            self.assertIn("preflight all", events)
            self.assertIn(env["MOCK_SOURCE_URL"], (root / "summary").read_text())

    def test_runner_rejects_rerun_or_supplied_id_before_vm_access(self):
        base = {
            **os.environ, "GITHUB_ACTIONS": "true", "GITHUB_REF": "refs/heads/main",
            "GITHUB_REPOSITORY": "drh-14/ChalkTalk", "MODE": "smoke",
            "EXPECTED_SHA": "a" * 40, "GITHUB_RUN_ID": "123456789",
            "VM_HOST": "example.invalid", "SSH_PRIVATE_KEY": "test-key",
            "VM_KNOWN_HOSTS": "test-host-key", "LOAD_TEST_REPORT_DIR": "/tmp/k6-dispatch-rejected",
        }
        for change in ({"GITHUB_RUN_ATTEMPT": "2"},
                       {"GITHUB_RUN_ATTEMPT": "1", "RUN_ID": "load-20261117-a1b2c3d4"}):
            with self.subTest(change=change):
                result = subprocess.run(["bash", str(RUNNER)], cwd=ROOT,
                                        env={**base, **change}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("refused", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
