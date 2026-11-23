import fcntl
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


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
                'active = sys.argv[2] in pathlib.Path(os.environ["SERVICES"]).read_text().splitlines()\n'
                'print("ActiveState=" + ("active" if active else "inactive"))\n'
                'print("ControlPID=999999" if active else "ControlPID=0")\n'
                'print("MainPID=0")\n')
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

    def test_managed_wrapper_waiting_on_deploy_lock_is_not_stock_activity(self):
        spec = importlib.util.spec_from_file_location('wait_apt', WAIT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            def service_status(command, **_):
                service = command[2]
                pid = 123 if service == active_service else 0
                return subprocess.CompletedProcess(command, 0,
                    f'ActiveState={"activating" if pid else "inactive"}\n'
                    f'ControlPID={pid}\nMainPID=0\n', '')

            for active_service, mode in (('apt-daily.service', b'update'),
                                         ('apt-daily-upgrade.service', b'install')):
                with self.subTest(service=active_service):
                    command_line = b'/usr/bin/bash\0' + module.WRAPPER + b'\0' + mode + b'\0'
                    with mock.patch.dict(os.environ, {'CHALKTALK_APT_LOCK_ROOT': directory,
                                                      'CHALKTALK_LOCK_WAIT': '0.1'}), \
                         mock.patch.object(module.subprocess, 'run', side_effect=service_status), \
                         mock.patch.object(Path, 'read_bytes', return_value=command_line):
                        self.assertEqual(module.main(), 0)
                        self.assertFalse(module.stock_service_busy(active_service))
                        with mock.patch.object(Path, 'read_bytes', return_value=b'/bin/sh\0/usr/lib/apt/apt.systemd.daily\0'):
                            self.assertTrue(module.stock_service_busy(active_service))


if __name__ == '__main__':
    unittest.main()
