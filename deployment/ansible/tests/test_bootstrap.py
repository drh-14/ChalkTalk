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

    def test_firewall_rule_order_and_host_preflight(self):
        play = yaml.safe_load((ANSIBLE / "bootstrap.yml").read_text())[0]
        pre_tasks = play["pre_tasks"]
        sudo_index = next(i for i, task in enumerate(pre_tasks) if task.get("ansible.builtin.command") == "sudo -n true")
        self.assertLess(sudo_index, len(pre_tasks))
        tasks = play["tasks"]
        firewall = [(index, task["community.general.ufw"])
                    for index, task in enumerate(tasks) if "community.general.ufw" in task]
        enable = next(index for index, rule in firewall if rule.get("state") == "enabled")
        matching_rules = [index for index, rule in firewall
                          if rule.get("proto") == "tcp" and rule.get("rule") == "allow"
                          and str(rule.get("port")) == "22"]
        self.assertTrue(matching_rules)
        self.assertTrue(all(index < enable for index in matching_rules))
        self.assertNotIn("bootstrap_ssh_port", play["vars"])
        self.assertIn(("443", "udp"), {(str(rule.get("port")), rule.get("proto")) for _, rule in firewall})
        self.assertTrue(any("ansible.builtin.wait_for_connection" in task for task in tasks[enable + 1:]))

    def test_private_shared_env_is_atomic_and_not_logged(self):
        play = yaml.safe_load((ANSIBLE / "bootstrap.yml").read_text())[0]
        self.assertNotIn("EMAIL_PROVIDER", play["vars"]["bootstrap_environment"])
        self.assertTrue({
            "SUPABASE_STORAGE_ENDPOINT", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_REGION",
            "SUPABASE_STORAGE_ACCESS_KEY_ID", "SUPABASE_STORAGE_SECRET_ACCESS_KEY",
        }.issubset(play["vars"]["bootstrap_environment"]))
        self.assertNotIn("S3_ENDPOINT", play["vars"]["bootstrap_environment"])
        self.assertNotIn("EMAIL_FROM", play["vars"]["bootstrap_environment"])
        tasks = play["tasks"]
        shared = next(task for task in tasks if task.get("ansible.builtin.file", {}).get("path") == "/srv/chalktalk/shared")
        self.assertEqual(shared["ansible.builtin.file"]["mode"], "0700")
        render = next(task for task in tasks if task.get("ansible.builtin.template", {}).get("dest") == "/srv/chalktalk/shared/production.env")
        self.assertTrue(render["no_log"])
        self.assertEqual(render["ansible.builtin.template"]["mode"], "0600")

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
