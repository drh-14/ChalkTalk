import hashlib
import hmac
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("vm_control.py")
RUN_ID = "load-20261117-a1b2c3d4"
SHA = "a" * 40
REF = "abcdefghijklmnopqrst"
HOST = "aws-0-us-east-1.pooler.supabase.com"
URL = f"postgresql://postgres.{REF}:secret@{HOST}:5432/postgres?sslmode=verify-full"


class VmControlTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name) / "load-test"
        self.root.mkdir(mode=0o700)
        self.env = pathlib.Path(self.temporary.name) / "production.env"
        self.env.write_text(f"DATABASE_URL='{URL}'\nDOMAIN=joinchalktalk.com\n")
        self.sha_file = pathlib.Path(self.temporary.name) / "deployed.sha"
        self.sha_file.write_text(SHA)
        self.nonce = "0123456789abcdef0123456789abcdef"
        self.mac = hmac.new(URL.encode(), self.nonce.encode(), hashlib.sha256).hexdigest()

    def call(self, mac=None, ref=REF, host=HOST, sha=SHA):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "prepare", "--root", str(self.root),
             "--env-file", str(self.env), "--deployed-sha-file", str(self.sha_file),
             "--run-id", RUN_ID, "--deployed-sha", sha, "--project-ref", ref,
             "--database-host", host, "--nonce", self.nonce, "--mac", mac or self.mac],
            text=True, capture_output=True,
        )

    def test_exact_secret_and_project_match_creates_only_owner_file(self):
        result = self.call()
        self.assertEqual(result.returncode, 0, result.stderr)
        dbfile = self.root / (RUN_ID + ".db-url")
        self.assertEqual(dbfile.read_text(), URL)
        self.assertEqual(dbfile.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("secret", result.stdout + result.stderr)
        self.assertEqual(self.call().returncode, 0)

    def test_wrong_secret_ref_host_or_sha_refuses_without_file(self):
        for kwargs in ({"mac": "0" * 64}, {"ref": "b" * 20}, {"host": "wrong.supabase.com"}, {"sha": "b" * 40}):
            with self.subTest(kwargs=kwargs):
                result = self.call(**kwargs)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / (RUN_ID + ".db-url")).exists())

    def test_changed_deployed_url_refuses_reuse(self):
        self.assertEqual(self.call().returncode, 0)
        self.env.write_text(f"DATABASE_URL='{URL.replace('secret', 'changed')}'\n")
        self.assertNotEqual(self.call().returncode, 0)

    def test_other_query_parameters_do_not_weaken_required_tls_mode(self):
        url = URL + "&application_name=chalktalk"
        self.env.write_text(f"DATABASE_URL='{url}'\n")
        self.mac = hmac.new(url.encode(), self.nonce.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(self.call().returncode, 0)

        self.env.write_text(f"DATABASE_URL='{URL}&sslmode=require'\n")
        self.assertNotEqual(self.call().returncode, 0)


if __name__ == "__main__":
    unittest.main()
