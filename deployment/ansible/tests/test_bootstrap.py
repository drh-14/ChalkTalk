"""Offline safety checks for the VM bootstrap; no host is modified."""

from pathlib import Path
import ast
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("validate_inputs", Path(__file__).with_name("validate_inputs.py"))
validate_inputs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_inputs)
ANSIBLE = ROOT / "deployment" / "ansible"
VALID_DOMAINS = (
    "joinchalktalk.com", "join-chalktalk.com", "xn--bcher-kva.example",
    "a" * 63 + ".example", ".".join(("a" * 63, "b" * 63, "c" * 63, "d" * 61)),
)
INVALID_DOMAINS = (
    "localhost", "join..chalktalk.com", ".chalktalk.com", "joinchalktalk.com.",
    "-join.chalktalk.com", "join-.chalktalk.com",
    "join.-chalktalk.com", "join.chalktalk-.com",
    "a" * 64 + ".example", ".".join(("a" * 63, "b" * 63, "c" * 63, "d" * 62)),
)


class BootstrapContractTest(unittest.TestCase):
    def test_manual_main_only_workflow_with_actions_secrets(self):
        workflow = yaml.load(
            (ROOT / ".github/workflows/vm-bootstrap.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(workflow["on"], {"workflow_dispatch": ""})
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        jobs = workflow["jobs"]
        self.assertEqual(len(jobs), 1)
        job = next(iter(jobs.values()))
        self.assertEqual(job["environment"], "production")
        expression = ast.parse(job["if"].replace("github.ref", "ref"), mode="eval")
        allowed = (ast.Expression, ast.Compare, ast.BoolOp, ast.Name, ast.Load,
                   ast.Constant, ast.Eq, ast.NotEq, ast.And, ast.Or)
        self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(expression)))
        self.assertTrue(all(node.id == "ref" for node in ast.walk(expression)
                            if isinstance(node, ast.Name)))
        for ref, expected in (("refs/heads/main", True),
                              ("refs/heads/feature", False),
                              ("refs/tags/main", False)):
            with self.subTest(ref=ref):
                self.assertEqual(eval(compile(expression, "<workflow-if>", "eval"),
                                      {"__builtins__": {}}, {"ref": ref}), expected)
        self.assertEqual(workflow["concurrency"]["cancel-in-progress"], "false")
        secret_step = job["steps"][-1]
        self.assertEqual(secret_step["env"]["SSH_PRIVATE_KEY"], "${{ secrets.SSH_PRIVATE_KEY }}")
        self.assertEqual(secret_step["env"]["DATABASE_URL"], "${{ secrets.DATABASE_URL }}")
        self.assertEqual(secret_step["env"]["SUPABASE_STORAGE_ACCESS_KEY_ID"], "${{ secrets.SUPABASE_STORAGE_ACCESS_KEY_ID }}")
        for name in ("VM_HOST", "VM_KNOWN_HOSTS", "SUPABASE_STORAGE_SECRET_ACCESS_KEY", "AUTH_TOKEN_SECRET", "RESEND_API_KEY"):
            with self.subTest(secret=name):
                self.assertEqual(secret_step["env"][name], "${{ secrets." + name + " }}")
        for name in ("DOMAIN", "SUPABASE_STORAGE_ENDPOINT", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_REGION"):
            with self.subTest(variable=name):
                self.assertEqual(secret_step["env"][name], "${{ vars." + name + " }}")
        self.assertNotIn("VM_SSH_PORT", secret_step["env"])
        self.assertNotIn("S3_ACCESS_KEY_ID", secret_step["env"])

    def test_pull_request_validation_is_secret_free(self):
        workflow = yaml.load(
            (ROOT / ".github/workflows/vm-bootstrap-verify.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertIn("pull_request", workflow["on"])
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        steps = workflow["jobs"]["verify"]["steps"]
        self.assertFalse(any("env" in step for step in steps))

    def test_firewall_preflight_rejects_conflicting_and_extra_rules(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "ufw"
            binary.write_text("""#!/bin/sh
printf '%s\\n' "Added user rules (see 'ufw status' for running firewall):"
if [ -n "$UFW_TEST_RULES" ]; then
    printf '%s\\n' "$UFW_TEST_RULES"
fi
""")
            binary.chmod(0o755)
            env = {**os.environ, "PATH": temporary + os.pathsep + os.environ["PATH"]}
            passed = Path(temporary) / "preflight-passed"
            command = ["ansible-playbook", "-i", "localhost,", str(ANSIBLE / "tests/check-firewall.yml"),
                       "-e", f"preflight_passed_path={passed}"]
            scenarios = (
                ("", True),
                ("(None)", True),
                ("ufw allow 22/tcp", True),
                ("ufw allow 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp\nufw allow 443/udp", True),
                ("(None)\nufw allow 22/tcp", False),
                ("ufw deny 22/tcp\nufw allow 22/tcp", False),
                ("ufw allow 3000/tcp", False),
                ("ufw allow from 203.0.113.4 to any port 22 proto tcp", False),
            )
            for rules, accepted in scenarios:
                with self.subTest(rules=rules):
                    passed.unlink(missing_ok=True)
                    result = subprocess.run(command, env={**env, "UFW_TEST_RULES": rules},
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)
                    self.assertEqual(passed.exists(), accepted)

    def test_runner_rejects_missing_and_mismatched_host_key(self):
        valid = {
            "SSH_PRIVATE_KEY": "test-private-key", "VM_HOST": "example.com",
            "VM_KNOWN_HOSTS": "example.com ssh-ed25519 AAAA",
            "DOMAIN": "joinchalktalk.com", "SUPABASE_STORAGE_ENDPOINT": "https://example.com",
            "SUPABASE_STORAGE_BUCKET": "test", "SUPABASE_STORAGE_REGION": "us-east-1",
            "DATABASE_URL": "postgres://test", "SUPABASE_STORAGE_ACCESS_KEY_ID": "test",
            "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "test", "AUTH_TOKEN_SECRET": "a" * 32,
            "RESEND_API_KEY": "test",
        }
        validate_inputs.validate(valid)
        for missing in ("DATABASE_URL", "SSH_PRIVATE_KEY", "VM_KNOWN_HOSTS", "SUPABASE_STORAGE_ACCESS_KEY_ID"):
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, "incomplete"):
                validate_inputs.validate({key: value for key, value in valid.items() if key != missing})
        with self.assertRaisesRegex(ValueError, "incomplete"):
            validate_inputs.validate({
                **{key: value for key, value in valid.items() if key != "SUPABASE_STORAGE_ACCESS_KEY_ID"},
                "S3_ACCESS_KEY_ID": "legacy-key",
            })
        with self.assertRaisesRegex(ValueError, "host key"):
            validate_inputs.validate({**valid, "VM_KNOWN_HOSTS": "other.com ssh-ed25519 AAAA"})
        with self.assertRaisesRegex(ValueError, "host key"):
            validate_inputs.validate({**valid, "VM_KNOWN_HOSTS": "[example.com]:2222 ssh-ed25519 AAAA"})
        with self.assertRaisesRegex(ValueError, "invalid"):
            validate_inputs.validate({**valid, "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "unsafe\\suffix"})
        with self.assertRaisesRegex(ValueError, "invalid"):
            validate_inputs.validate({**valid, "VM_HOST": "-bad-host"})

    def test_runner_rejects_invalid_domain_labels(self):
        valid = {
            "SSH_PRIVATE_KEY": "test-private-key", "VM_HOST": "example.com",
            "VM_KNOWN_HOSTS": "example.com ssh-ed25519 AAAA",
            "DOMAIN": "joinchalktalk.com", "SUPABASE_STORAGE_ENDPOINT": "https://example.com",
            "SUPABASE_STORAGE_BUCKET": "test", "SUPABASE_STORAGE_REGION": "us-east-1",
            "DATABASE_URL": "postgres://test", "SUPABASE_STORAGE_ACCESS_KEY_ID": "test",
            "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "test", "AUTH_TOKEN_SECRET": "a" * 32,
            "RESEND_API_KEY": "test",
        }
        for domain in VALID_DOMAINS:
            with self.subTest(domain=domain):
                validate_inputs.validate({**valid, "DOMAIN": domain})
        for domain in INVALID_DOMAINS:
            with self.subTest(domain=domain), self.assertRaisesRegex(ValueError, "domain is invalid"):
                validate_inputs.validate({**valid, "DOMAIN": domain})

    def test_ansible_rejects_invalid_domain_before_replacing_env(self):
        env = {
            **os.environ,
            "DOMAIN": "joinchalktalk.com", "DATABASE_URL": "postgresql://test",
            "SUPABASE_STORAGE_ENDPOINT": "https://example.com/storage/v1/s3",
            "SUPABASE_STORAGE_BUCKET": "test", "SUPABASE_STORAGE_REGION": "us-east-1",
            "SUPABASE_STORAGE_ACCESS_KEY_ID": "fake-access",
            "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "fake-secret",
            "AUTH_TOKEN_SECRET": "a" * 32, "RESEND_API_KEY": "fake-key",
        }
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "production.env"
            target.write_text("existing production config\n")
            env.update({
                "CHALKTALK_ROOT": str(ROOT), "ANSIBLE_HOME": temporary,
                "ANSIBLE_LOCAL_TEMP": str(Path(temporary) / "ansible-tmp"),
                "ANSIBLE_REMOTE_TEMP": str(Path(temporary) / "remote-tmp"),
            })
            command = ["ansible-playbook", "-i", "localhost,", str(ANSIBLE / "tests/render-env.yml"),
                       "-e", f"output_path={target}"]
            for domain in INVALID_DOMAINS:
                with self.subTest(domain=domain):
                    result = subprocess.run(command, env={**env, "DOMAIN": domain},
                                            capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(target.read_text(), "existing production config\n")
            for domain in VALID_DOMAINS:
                with self.subTest(domain=domain):
                    result = subprocess.run(command, env={**env, "DOMAIN": domain},
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn(f"DOMAIN='{domain}'", target.read_text())

    def test_workflow_shell_writes_fixed_port_inventory_without_contacting_vm(self):
        workflow = yaml.load(
            (ROOT / ".github/workflows/vm-bootstrap.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        script = workflow["jobs"]["bootstrap"]["steps"][-1]["run"]
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "ansible-playbook"
            binary.write_text('#!/bin/sh\ncp "$2" "$INVENTORY_CAPTURE"\n')
            binary.chmod(0o755)
            capture = Path(temporary) / "inventory.txt"
            env = {
                **os.environ,
                "PATH": temporary + os.pathsep + os.environ["PATH"],
                "GITHUB_REF": "refs/heads/main",
                "INVENTORY_CAPTURE": str(capture),
                "SSH_PRIVATE_KEY": "fake-private-key",
                "VM_HOST": "example.com",
                "VM_KNOWN_HOSTS": "example.com ssh-ed25519 AAAA",
                "VM_SSH_PORT": "2222",  # legacy setting must have no effect
                "DOMAIN": "joinchalktalk.com",
                "DATABASE_URL": "postgresql://example",
                "SUPABASE_STORAGE_ENDPOINT": "https://example.com/storage/v1/s3",
                "SUPABASE_STORAGE_BUCKET": "test",
                "SUPABASE_STORAGE_REGION": "us-east-1",
                "SUPABASE_STORAGE_ACCESS_KEY_ID": "fake-access",
                "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "fake-secret",
                "AUTH_TOKEN_SECRET": "a" * 32,
                "RESEND_API_KEY": "fake-key",
            }
            result = subprocess.run(["bash", "-e", "-c", script], cwd=ROOT,
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(capture.read_text(),
                             "[chalktalk]\nexample.com ansible_user=ubuntu ansible_port=22\n")
            self.assertNotIn("fake-secret", result.stdout + result.stderr)

    def test_fake_env_render_is_stable_and_compose_uses_same_file(self):
        env = {
            **os.environ,
            "DOMAIN": "joinchalktalk.com", "DATABASE_URL": "postgresql://test:encoded%23@db.example/postgres?sslmode=require",
            "SUPABASE_STORAGE_ENDPOINT": "https://example.com/storage/v1/s3", "SUPABASE_STORAGE_BUCKET": "test", "SUPABASE_STORAGE_REGION": "us-east-1",
            "SUPABASE_STORAGE_ACCESS_KEY_ID": "fake-access", "SUPABASE_STORAGE_SECRET_ACCESS_KEY": "fake'#$value",
            "AUTH_TOKEN_SECRET": "a" * 32, "RESEND_API_KEY": "fake-key",
        }
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "production.env"
            env["CHALKTALK_ROOT"] = str(ROOT)
            env["ANSIBLE_HOME"] = temporary
            env["ANSIBLE_LOCAL_TEMP"] = str(Path(temporary) / "ansible-tmp")
            env["ANSIBLE_REMOTE_TEMP"] = str(Path(temporary) / "remote-tmp")
            command = ["ansible-playbook", "-i", "localhost,", str(ANSIBLE / "tests/render-env.yml"),
                       "-e", f"output_path={target}"]
            first = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            contents = target.read_text()
            self.assertNotIn("EMAIL_PROVIDER=", contents)
            self.assertNotIn("EMAIL_FROM=", contents)
            self.assertNotIn("fake-secret", first.stdout)
            second = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            self.assertIn("changed=0", second.stdout)
            self.assertEqual(target.read_text(), contents)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            missing_env = {**env, "DATABASE_URL": ""}
            failed = subprocess.run(command, env=missing_env, capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(target.read_text(), contents)
            self.assertNotIn("fake'#$value", failed.stdout + failed.stderr)
            render_failure = subprocess.run(
                [*command, "-e", json.dumps({
                    "validate_environment": False,
                    "bootstrap_environment": {
                        "SECRET": "render-failure-secret",
                        "BROKEN": "{{ undefined_render_value }}",
                    },
                })], env=env, capture_output=True, text=True,
            )
            self.assertNotEqual(render_failure.returncode, 0)
            self.assertEqual(target.read_text(), contents)
            self.assertNotIn("render-failure-secret", render_failure.stdout + render_failure.stderr)
            compose = Path(temporary) / "compose.yml"
            compose.write_text("services:\n  check:\n    image: busybox\n    env_file: ${COMPOSE_ENV_FILE}\n    environment:\n      DOMAIN: ${DOMAIN}\n")
            compose_env = {**env, "COMPOSE_ENV_FILE": str(target)}
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(target), "-f", str(compose), "config", "--format", "json"],
                env=compose_env, capture_output=True, text=True, check=True,
            )
            rendered = json.loads(result.stdout)["services"]["check"]["environment"]
            self.assertEqual(rendered["DOMAIN"], "joinchalktalk.com")
            # Compose's config model escapes literal dollars before container creation.
            self.assertEqual(rendered["SUPABASE_STORAGE_SECRET_ACCESS_KEY"], "fake'#$$value")
            self.assertTrue({
                "SUPABASE_STORAGE_ENDPOINT", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_REGION",
                "SUPABASE_STORAGE_ACCESS_KEY_ID", "SUPABASE_STORAGE_SECRET_ACCESS_KEY",
            }.issubset(rendered))
            self.assertFalse(any(key.startswith("S3_") for key in rendered))


if __name__ == "__main__":
    unittest.main()
