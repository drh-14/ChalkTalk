import fcntl
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


WAIT = Path(__file__).resolve().parents[2] / 'maintenance/wait-apt.py'


class StockAptWaitTest(unittest.TestCase):
    def test_active_service_and_native_locks_delay_or_time_out_without_interruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            services = root / 'services'
            services.write_text('apt-daily.service\n')
            systemctl = root / 'systemctl'
            systemctl.write_text('#!' + sys.executable + '\n'
                'import os, pathlib, sys\n'
                'print("active" if sys.argv[2] in pathlib.Path(os.environ["SERVICES"]).read_text().splitlines() else "inactive")\n')
            systemctl.chmod(0o755)
            lock = root / 'var/lib/dpkg/lock-frontend'
            lock.parent.mkdir(parents=True)
            lock.touch()
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                   'SERVICES': str(services), 'CHALKTALK_APT_LOCK_ROOT': str(root),
                   'CHALKTALK_LOCK_WAIT': '0.25'}

            def wait():
                return subprocess.run([sys.executable, str(WAIT)], env=env, capture_output=True, text=True)

            self.assertNotEqual(wait().returncode, 0)
            services.write_text('apt-daily-upgrade.service\n')
            self.assertNotEqual(wait().returncode, 0)
            services.write_text('')
            child = subprocess.Popen([sys.executable, '-c',
                'import fcntl,sys,time; f=open(sys.argv[1], "r+"); '
                'fcntl.lockf(f, fcntl.LOCK_EX); print("ready", flush=True); time.sleep(1)',
                str(lock)],
                stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            self.assertNotEqual(wait().returncode, 0)
            self.assertIsNone(child.poll())
            self.assertEqual(child.wait(), 0)
            child.stdout.close()
            self.assertEqual(wait().returncode, 0)
            self.assertTrue(lock.exists())


if __name__ == '__main__':
    unittest.main()
