"""Offline safety checks for the VM bootstrap; no host is modified."""

from pathlib import Path
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
        self.assertIn("refs/heads/main", job["if"])
        self.assertEqual(workflow["concurrency"]["cancel-in-progress"], "false")
        secret_step = job["steps"][-1]
        self.assertEqual(secret_step["env"]["SSH_PRIVATE_KEY"], "${{ secrets.SSH_PRIVATE_KEY }}")
        self.assertEqual(secret_step["env"]["DATABASE_URL"], "${{ secrets.DATABASE_URL }}")

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
        ssh_rule = next(index for index, rule in firewall
                        if rule.get("proto") == "tcp" and "bootstrap_ssh_port" in rule.get("port", ""))
        enable = next(index for index, rule in firewall if rule.get("state") == "enabled")
        self.assertLess(ssh_rule, enable)
        self.assertIn(("443", "udp"), {(str(rule.get("port")), rule.get("proto")) for _, rule in firewall})
        self.assertTrue(any("ansible.builtin.wait_for_connection" in task for task in tasks[enable + 1:]))

    def test_private_shared_env_is_atomic_and_not_logged(self):
        play = yaml.safe_load((ANSIBLE / "bootstrap.yml").read_text())[0]
        tasks = play["tasks"]
        shared = next(task for task in tasks if task.get("ansible.builtin.file", {}).get("path") == "/srv/chalktalk/shared")
        self.assertEqual(shared["ansible.builtin.file"]["mode"], "0700")
        render = next(task for task in tasks if task.get("ansible.builtin.template", {}).get("dest") == "/srv/chalktalk/shared/production.env")
        self.assertTrue(render["no_log"])
        self.assertEqual(render["ansible.builtin.template"]["mode"], "0600")
        self.assertFalse((ANSIBLE / "group_vars/production/vault.yml").exists())

    def test_runner_rejects_missing_and_mismatched_host_key(self):
        valid = {
            "SSH_PRIVATE_KEY": "test-private-key", "VM_HOST": "example.com",
            "VM_SSH_PORT": "2222", "VM_KNOWN_HOSTS": "[example.com]:2222 ssh-ed25519 AAAA",
            "DOMAIN": "joinchalktalk.com", "S3_ENDPOINT": "https://example.com",
            "S3_BUCKET": "test", "S3_REGION": "us-east-1",
            "DATABASE_URL": "postgres://test", "S3_ACCESS_KEY_ID": "test",
            "S3_SECRET_ACCESS_KEY": "test", "AUTH_TOKEN_SECRET": "a" * 32,
            "RESEND_API_KEY": "test",
        }
        validate_inputs.validate(valid)
        for missing in ("DATABASE_URL", "SSH_PRIVATE_KEY", "VM_KNOWN_HOSTS"):
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, "incomplete"):
                validate_inputs.validate({key: value for key, value in valid.items() if key != missing})
        with self.assertRaisesRegex(ValueError, "host key"):
            validate_inputs.validate({**valid, "VM_KNOWN_HOSTS": "[other.com]:2222 ssh-ed25519 AAAA"})
        with self.assertRaisesRegex(ValueError, "invalid"):
            validate_inputs.validate({**valid, "S3_SECRET_ACCESS_KEY": "unsafe\\suffix"})
        with self.assertRaisesRegex(ValueError, "invalid"):
            validate_inputs.validate({**valid, "VM_HOST": "-bad-host"})

    def test_fake_env_render_is_stable_and_compose_uses_same_file(self):
        env = {
            **os.environ,
            "DOMAIN": "joinchalktalk.com", "DATABASE_URL": "postgresql://test:encoded%23@db.example/postgres?sslmode=require",
            "S3_ENDPOINT": "https://example.com/storage/v1/s3", "S3_BUCKET": "test", "S3_REGION": "us-east-1",
            "S3_ACCESS_KEY_ID": "fake-access", "S3_SECRET_ACCESS_KEY": "fake'#$value",
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
            self.assertEqual(rendered["S3_SECRET_ACCESS_KEY"], "fake'#$$value")


if __name__ == "__main__":
    unittest.main()
