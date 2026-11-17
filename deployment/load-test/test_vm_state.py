import json
import hashlib
import hmac
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

SCRIPT = pathlib.Path(__file__).with_name("vm_state.py")
SHA = "a" * 40
RUN_ID = "load-20261117-a1b2c3d4"
PROFILE = {"maxVus": 20, "stageMinutes": [1, 3, 3, 3], "stageTargets": [1, 5, 10, 20], "rampWriteAttempts": 17}
REF = "abcdefghijklmnopqrst"
HOST = "aws-0-us-east-1.pooler.supabase.com"
SOURCE_RUN = "44156607166"
NONCE = "a" * 32


class VmStateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name) / "load-test"
        self.root.mkdir(mode=0o700)
        self.profile = pathlib.Path(self.temporary.name) / "profile.json"
        self.profile.write_text(json.dumps(PROFILE, separators=(",", ":")))
        self.database_url = f"postgresql://postgres.{REF}:test-only@{HOST}/postgres?sslmode=verify-full"
        self.env_file = pathlib.Path(self.temporary.name) / "production.env"
        self.env_file.write_text(f"DATABASE_URL={self.database_url}\n")
        self.sha_file = pathlib.Path(self.temporary.name) / "deployed.sha"
        self.sha_file.write_text(SHA)

    def auto(self, action, source_run=SOURCE_RUN, sha=SHA, profile=None,
             project_ref=REF, database_host=HOST, nonce=NONCE):
        mac = hmac.new(self.database_url.encode(), nonce.encode(), hashlib.sha256).hexdigest()
        args = [sys.executable, str(SCRIPT), action, "--root", str(self.root),
                "--deployed-sha", sha, "--profile-file", str(profile or self.profile),
                "--project-ref", project_ref, "--database-host", database_host,
                "--nonce", nonce, "--mac", mac, "--env-file", str(self.env_file),
                "--deployed-sha-file", str(self.sha_file)]
        if action == "claim-smoke-auto":
            args.extend(["--source-run-id", source_run])
        return subprocess.run(args, text=True, capture_output=True)

    def auto_ok(self, action, **kwargs):
        result = self.auto(action, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def mark_fixture_files(self, run_id):
        manifest = self.root / f"{run_id}.json"
        users = [{"id": str(uuid.UUID(int=i + 1)),
                  "email": f"vu{i + 1:02d}@{run_id}.loadtest.invalid",
                  "password": "test-only"} for i in range(20)]
        manifest.write_text(json.dumps({"runId": run_id, "deployedSha": SHA,
                                        "baseUrl": "https://joinchalktalk.com",
                                        "expectedProjectRef": REF, "expectedHost": HOST,
                                        "organizationId": str(uuid.UUID(int=101)),
                                        "courseId": str(uuid.UUID(int=102)),
                                        "questionId": str(uuid.UUID(int=103)),
                                        "pollId": str(uuid.UUID(int=104)),
                                        "pollOptionId": str(uuid.UUID(int=105)),
                                        "users": users}))
        manifest.chmod(0o600)
        target = self.root / f"{run_id}.db-url"
        target.write_text(self.database_url)
        target.chmod(0o600)
        return manifest, target

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

    def test_auto_smoke_id_is_valid_provenanced_and_blocks_other_smoke_until_cleaned(self):
        claimed = self.auto_ok("claim-smoke-auto")
        run_id = claimed["runId"]
        self.assertRegex(run_id, r"^load-\d{8}-[a-z0-9]{8,32}$")
        self.assertEqual(claimed["sourceRunUrl"],
                         f"https://github.com/drh-14/ChalkTalk/actions/runs/{SOURCE_RUN}")
        state = json.loads((self.root / f"{run_id}.state.json").read_text())
        self.assertEqual(state["projectRef"], REF)
        self.assertEqual(state["databaseHost"], HOST)
        self.assertEqual(state["sourceRunId"], SOURCE_RUN)
        self.assertEqual(state["sourceRunUrl"], claimed["sourceRunUrl"])
        self.assertNotIn(self.database_url, json.dumps(state))
        self.assertNotEqual(self.auto("claim-smoke-auto", source_run="44156607167").returncode, 0)
        self.assertNotEqual(self.auto("claim-smoke-auto").returncode, 0)
        self.assertEqual(len(list(self.root.glob("*.state.json"))), 1)

    def test_auto_ramp_selects_only_recent_verified_fixture_once(self):
        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        manifest, _ = self.mark_fixture_files(run_id)
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        self.assertEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        state = json.loads((self.root / f"{run_id}.state.json").read_text())
        self.assertEqual(state["verifiedManifestSha256"], hashlib.sha256(manifest.read_bytes()).hexdigest())
        selected = self.auto_ok("claim-ramp-auto")
        self.assertEqual(selected["runId"], run_id)
        self.assertEqual(selected["sourceRunUrl"],
                         f"https://github.com/drh-14/ChalkTalk/actions/runs/{SOURCE_RUN}")
        self.assertEqual(selected["status"], "ramp-claimed")
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)

    def test_auto_ramp_rejects_well_formed_manifest_replacement_without_mutation(self):
        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        manifest, _ = self.mark_fixture_files(run_id)
        self.assertEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        state_path = self.root / f"{run_id}.state.json"
        verified_state = state_path.read_bytes()
        replacement = json.loads(manifest.read_text())
        replacement["courseId"] = str(uuid.UUID(int=202))
        replacement["users"][0]["id"] = str(uuid.UUID(int=203))
        manifest.write_text(json.dumps(replacement))
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        self.assertEqual(state_path.read_bytes(), verified_state)

    def test_auto_claims_reject_wrong_deployed_target_without_state_mutation(self):
        for kwargs in ({"sha": "b" * 40}, {"project_ref": "z" * 20},
                       {"database_host": "wrong.supabase.com"}):
            with self.subTest(action="claim-smoke-auto", kwargs=kwargs):
                self.assertNotEqual(self.auto("claim-smoke-auto", **kwargs).returncode, 0)
                self.assertFalse(list(self.root.glob("*.state.json")))

        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        self.mark_fixture_files(run_id)
        self.assertEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        state_path = self.root / f"{run_id}.state.json"
        verified_state = state_path.read_bytes()
        for kwargs in ({"sha": "b" * 40}, {"project_ref": "z" * 20},
                       {"database_host": "wrong.supabase.com"}):
            with self.subTest(action="claim-ramp-auto", kwargs=kwargs):
                self.assertNotEqual(self.auto("claim-ramp-auto", **kwargs).returncode, 0)
                self.assertEqual(state_path.read_bytes(), verified_state)

    def test_auto_smoke_verification_requires_owner_only_manifest(self):
        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        state_path = self.root / f"{run_id}.state.json"
        claimed_state = state_path.read_bytes()
        self.assertNotEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        self.assertEqual(state_path.read_bytes(), claimed_state)
        manifest, _ = self.mark_fixture_files(run_id)
        manifest.chmod(0o644)
        self.assertNotEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        self.assertEqual(state_path.read_bytes(), claimed_state)

    def test_auto_ramp_fails_closed_on_stale_identity_manifest_or_ambiguity(self):
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        manifest, target = self.mark_fixture_files(run_id)
        self.assertEqual(self.call("verify-smoke", run_id=run_id).returncode, 0)
        state_path = self.root / f"{run_id}.state.json"
        original = json.loads(state_path.read_text())
        for changed in ({"verifiedAt": 1}, {"projectRef": "z" * 20}):
            state_path.write_text(json.dumps({**original, **changed}))
            self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
            self.assertEqual(json.loads(state_path.read_text())["status"], "smoke-verified")
        state_path.write_text(json.dumps(original))
        manifest.unlink()
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        self.mark_fixture_files(run_id)
        invalid = json.loads(manifest.read_text())
        invalid["users"] = []
        manifest.write_text(json.dumps(invalid))
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        self.mark_fixture_files(run_id)
        self.database_url = self.database_url.replace("test-only", "changed-test-only")
        self.env_file.write_text(f"DATABASE_URL={self.database_url}\n")
        self.assertNotEqual(self.auto("claim-ramp-auto").returncode, 0)
        self.database_url = self.database_url.replace("changed-test-only", "test-only")
        self.env_file.write_text(f"DATABASE_URL={self.database_url}\n")
        second_id = "load-20261117-gh44156607168"
        second_state = {**original, "runId": second_id, "sourceRunId": "44156607168",
                        "sourceRunUrl": "https://github.com/drh-14/ChalkTalk/actions/runs/44156607168"}
        (self.root / f"{second_id}.state.json").write_text(json.dumps(second_state))
        (self.root / f"{second_id}.state.json").chmod(0o600)
        ambiguous = self.auto("claim-ramp-auto")
        self.assertNotEqual(ambiguous.returncode, 0)
        self.assertIn("exactly one", ambiguous.stderr)
        self.assertEqual(json.loads(state_path.read_text())["status"], "smoke-verified")
        target.unlink()

    def test_auto_smoke_ignores_legacy_cleaned_but_refuses_orphans(self):
        self.assert_ok("claim-smoke")
        self.assert_ok("mark-cleaned")
        self.assertEqual(self.auto("claim-smoke-auto").returncode, 0)
        self.assertNotEqual(self.auto("claim-smoke-auto", source_run="44156607167").returncode, 0)

    def test_auto_smoke_refuses_malformed_or_uncertain_legacy_state(self):
        state_path = self.root / (RUN_ID + ".state.json")
        state_path.write_text("not json")
        self.assertNotEqual(self.auto("claim-smoke-auto").returncode, 0)
        state_path.unlink()
        orphan = self.root / (RUN_ID + ".json")
        orphan.write_text("{}")
        self.assertNotEqual(self.auto("claim-smoke-auto").returncode, 0)

    def test_source_workflow_run_cannot_be_reused_across_utc_dates(self):
        run_id = self.auto_ok("claim-smoke-auto")["runId"]
        self.assertEqual(self.call("mark-cleaned", run_id=run_id).returncode, 0)
        state_path = self.root / f"{run_id}.state.json"
        state = json.loads(state_path.read_text())
        prior_id = "load-20260101-gh" + SOURCE_RUN
        state["runId"] = prior_id
        state_path.rename(self.root / f"{prior_id}.state.json")
        (self.root / f"{prior_id}.state.json").write_text(json.dumps(state))
        self.assertNotEqual(self.auto("claim-smoke-auto").returncode, 0)
        self.assertEqual(len(list(self.root.glob("*.state.json"))), 1)

    def test_parallel_auto_smoke_claims_with_distinct_source_runs_allow_only_one(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda source: self.auto("claim-smoke-auto", source_run=source),
                                    ("44156607166", "44156607167")))
        self.assertEqual(sorted(result.returncode for result in results), [0, 1])
        self.assertEqual(len(list(self.root.glob("*.state.json"))), 1)


if __name__ == "__main__":
    unittest.main()
