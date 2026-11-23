"""Effective exclusion policy at the verifier's public check seam."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock


POLICY = Path(__file__).resolve().parents[2] / 'maintenance/policy.py'
spec = importlib.util.spec_from_file_location('maintenance_policy', POLICY)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ExclusionPolicyTest(unittest.TestCase):
    def test_removed_operator_pattern_fails_while_addition_passes(self):
        runtime = [r'^docker([.-].*)?$', r'^containerd([.-].*)?$', r'^runc([.-].*)?$']
        required = {
            'Unattended-Upgrade::Origins-Pattern': [
                'origin=Ubuntu,archive=jammy-security',
                'origin=UbuntuESMApps,archive=jammy-apps-security',
                'origin=UbuntuESM,archive=jammy-infra-security'],
            'DPkg::Options': ['--force-confdef', '--force-confold'],
        }

        class Config:
            def __init__(self, exclusions):
                self.exclusions = exclusions

            def value_list(self, key):
                if key == 'Unattended-Upgrade::Package-Blacklist':
                    return self.exclusions
                return required.get(key, [])

            def find(self, key):
                if key.startswith('Unattended-Upgrade::') and key.split('::')[-1] in policy.FALSE_KEYS:
                    return 'false'
                return {'Unattended-Upgrade::Mail': '', 'APT::Periodic::Enable': '1',
                        'APT::Periodic::Update-Package-Lists': 'always',
                        'APT::Periodic::Unattended-Upgrade': 'always',
                        'APT::Periodic::RandomSleep': '0',
                        'APT::Periodic::Download-Upgradeable-Packages': '0',
                        'APT::Periodic::AutocleanInterval': '0',
                        'APT::Periodic::CleanInterval': '0',
                        'APT::Update::Error-Mode': 'any'}[key]

        apt_pkg = SimpleNamespace(init=lambda: None, config=Config(runtime))
        with mock.patch.dict(sys.modules, {'apt_pkg': apt_pkg}), \
             mock.patch.object(policy, 'release', return_value='jammy'), \
             mock.patch.object(policy, 'exclusion_baseline', return_value=['^ct-operator$']), \
             mock.patch.object(policy.subprocess, 'run', return_value=SimpleNamespace(returncode=0)):
            self.assertIn('policy: missing operator exclusions', policy.check())
            apt_pkg.config.exclusions = ['^ct-operator$', *runtime, '^ct-extra$']
            self.assertNotIn('policy: missing operator exclusions', policy.check())


if __name__ == '__main__':
    unittest.main()
