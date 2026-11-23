"""Effective timer policy through the verifier's command-line interface."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


TIMER = Path(__file__).resolve().parents[2] / 'maintenance/timer.py'


class EffectiveTimerTest(unittest.TestCase):
    def verify(self, drift=''):
        with tempfile.TemporaryDirectory() as directory:
            systemctl = Path(directory) / 'systemctl'
            systemctl.write_text('''#!''' + sys.executable + '''
import os, sys
unit, key = sys.argv[2], sys.argv[4]
hour = '03' if unit == 'apt-daily.timer' else '04'
values = {'Persistent': 'yes', 'RandomizedDelayUSec': '30min',
          'AccuracyUSec': '1us', 'Unit': unit.removesuffix('.timer') + '.service',
          'TimersCalendar': '{ OnCalendar=*-*-* ' + hour + ':00:00 UTC ; next_elapse=0 }'}
if os.environ.get('DRIFT') == unit + ':' + key:
    values[key] = ('{ OnCalendar=*-*-* 05:00:00 UTC ; next_elapse=0 }'
                   if key == 'TimersCalendar' else 'other.service' if key == 'Unit' else '45min')
print(values[key])
''')
            systemctl.chmod(0o755)
            return subprocess.run([sys.executable, str(TIMER)],
                                  env={**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'],
                                       'DRIFT': drift}, capture_output=True, text=True).returncode

    def test_exact_effective_schedule_passes(self):
        self.assertEqual(self.verify(), 0)

    def test_later_calendar_or_jitter_override_fails_for_each_timer(self):
        for unit in ('apt-daily.timer', 'apt-daily-upgrade.timer'):
            for key in ('TimersCalendar', 'RandomizedDelayUSec', 'Unit'):
                with self.subTest(unit=unit, key=key):
                    self.assertNotEqual(self.verify(unit + ':' + key), 0)
