import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class CiWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            [
                "ruby", "-ryaml", "-rjson", "-e",
                "puts JSON.generate(YAML.load_file(ARGV[0])['jobs']['supabase-integration']['steps'])",
                str(WORKFLOW),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        cls.steps = {step["name"]: step for step in json.loads(result.stdout)}

    def test_cleanup_failures_fail_the_step(self):
        for step_name, command in (
            ("Remove isolated API and migration containers", "docker"),
            ("Remove disposable local Supabase stack and volumes", "npx"),
        ):
            with self.subTest(step=step_name):
                step = self.steps[step_name]
                self.assertEqual(step["if"], "always()")
                with tempfile.TemporaryDirectory() as directory:
                    executable = pathlib.Path(directory) / command
                    executable.write_text("#!/bin/sh\nexit \"$CLEANUP_EXIT\"\n")
                    executable.chmod(0o755)
                    env = {
                        **os.environ,
                        "PATH": directory + os.pathsep + os.environ["PATH"],
                    }
                    for exit_code in (0, 19):
                        result = subprocess.run(
                            ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step["run"]],
                            cwd=ROOT,
                            capture_output=True,
                            text=True,
                            env={**env, "CLEANUP_EXIT": str(exit_code)},
                        )
                        self.assertEqual(result.returncode, exit_code, result.stderr)


if __name__ == "__main__":
    unittest.main()
