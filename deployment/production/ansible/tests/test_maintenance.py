"""Semantic Ansible package/coordination contracts, supplemented by real CI guests."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


class MaintenanceBootstrapTest(unittest.TestCase):
    def test_every_bootstrap_package_operation_has_bounded_native_lock_wait(self):
        files = [ROOT / 'bootstrap.yml', ROOT / 'tasks/maintenance.yml']
        count = 0
        def inspect(node):
            nonlocal count
            if isinstance(node, dict):
                if 'ansible.builtin.apt' in node:
                    count += 1
                    self.assertEqual(node['ansible.builtin.apt'].get('lock_timeout'), 300)
                for value in node.values():
                    inspect(value)
            elif isinstance(node, list):
                for value in node:
                    inspect(value)
        for path in files:
            self.assertTrue(path.exists(), str(path))
            inspect(yaml.safe_load(path.read_text()))
        self.assertGreaterEqual(count, 3)

    def test_bootstrap_establishes_hold_before_package_tasks_and_clears_own_token_last(self):
        play = yaml.safe_load((ROOT / 'bootstrap.yml').read_text())[0]
        tasks = play['tasks']
        self.assertEqual(tasks[0].get('ansible.builtin.import_tasks'), 'tasks/maintenance-prepare.yml')
        final = tasks[-1]['ansible.builtin.command']['argv']
        self.assertEqual(final[:3], ['/usr/local/lib/chalktalk-maintenance/hold.sh', 'clear', 'bootstrap'])
        self.assertEqual(final[3], '{{ maintenance_bootstrap_token.stdout }}')
