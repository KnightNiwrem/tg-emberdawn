#!/usr/bin/env python3
"""Exercise pg-local.sh ownership and exit paths without Docker or a database."""

from pathlib import Path
import os
import signal
import subprocess
import tempfile
import time
import unittest


MOCK_COMMAND = r'''#!/usr/bin/env python3
from pathlib import Path
import os, signal, sys
root = Path(os.environ['MOCK_STATE'])
run = os.environ['MOCK_RUN']
created = root / (run + '.created')
args = sys.argv[1:]
if Path(sys.argv[0]).name == 'deno':
    assert args == ['task', 'test:pg'], args
    assert os.environ['TEST_PG_URL'] == (
        'postgresql://postgres:postgres@127.0.0.1:' + str(55000 + int(run)) + '/postgres'
    )
    sys.exit(int(os.environ.get('MOCK_TEST_EXIT', '0')))
if args[0] == 'run':
    assert args[args.index('-p') + 1] == '127.0.0.1::5432'
    if os.environ.get('MOCK_START_FAIL'):
        sys.exit(7)
    name = args[args.index('--name') + 1] if '--name' in args else 'container-' + run
    (root / ('container-' + name)).write_text('running')
    created.write_text(name)
    if os.environ.get('MOCK_INTERRUPT_START'):
        # The daemon has created the resource, but the CLI has not returned its ID.
        signal.signal(signal.SIGINT, lambda *_: sys.exit(130))
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
        (root / (run + '.interruptible')).touch()
        signal.pause()
    print(name)
elif args[0] == 'port':
    assert args == ['port', created.read_text(), '5432/tcp'], args
    print('127.0.0.1:' + str(55000 + int(run)))
elif args[0] == 'exec':
    assert args == ['exec', created.read_text(), 'pg_isready', '-U', 'postgres'], args
    sys.exit(1 if os.environ.get('MOCK_NOT_READY') else 0)
elif args[0] == 'rm':
    assert args[:2] == ['rm', '-f'], args
    if created.exists():
        assert args[2] == created.read_text(), args
    (root / ('container-' + args[2])).unlink(missing_ok=True)
else:
    raise AssertionError(args)
'''


class PgLocalTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='emberdawn-pg-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin_dir = self.root / 'bin'
        self.bin_dir.mkdir()
        (self.root / 'tmp').mkdir()
        for command in ['docker', 'deno']:
            executable = self.bin_dir / command
            executable.write_text(MOCK_COMMAND)
            executable.chmod(0o755)
        sleep = self.bin_dir / 'sleep'
        sleep.write_text('#!/bin/sh\nexit 0\n')
        sleep.chmod(0o755)
        self.foreign = self.root / 'container-unrelated'
        self.foreign.write_text('preserve')

    def start(self, number, **options):
        environment = dict(
            os.environ,
            PATH=str(self.bin_dir) + ':' + os.environ['PATH'],
            TMPDIR=str(self.root / 'tmp'),
            MOCK_STATE=str(self.root),
            MOCK_RUN=str(number),
            **options,
        )
        process = subprocess.Popen(
            ['sh', str(Path(__file__).with_name('pg-local.sh'))],
            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True,
        )
        self.addCleanup(self.stop, process)
        return process

    def stop(self, process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()

    def finish(self, process, expected):
        stdout, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, expected, stdout + stderr)

    def assert_clean(self):
        self.assertEqual(list(self.root.glob('container-*')), [self.foreign])
        self.assertEqual(self.foreign.read_text(), 'preserve')
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])

    def test_concurrent_runs_own_distinct_containers_and_ports(self):
        processes = [self.start(number) for number in [1, 2]]
        for process in processes:
            self.finish(process, 0)
        names = [(self.root / f'{number}.created').read_text() for number in [1, 2]]
        self.assertNotEqual(*names)
        self.assert_clean()

    def test_failures_preserve_status_and_clean_up(self):
        cases = [
            (37, {'MOCK_TEST_EXIT': '37'}),
            (7, {'MOCK_START_FAIL': '1'}),
            (1, {'MOCK_NOT_READY': '1'}),
        ]
        for number, (expected, options) in enumerate(cases, start=1):
            with self.subTest(options=options):
                self.finish(self.start(number, **options), expected)
                self.assert_clean()

    def test_interrupt_during_container_acquisition(self):
        for number, interrupt in enumerate([signal.SIGINT, signal.SIGTERM], start=1):
            with self.subTest(interrupt=interrupt):
                process = self.start(number, MOCK_INTERRUPT_START='1')
                ready = self.root / f'{number}.interruptible'
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    self.assertIsNone(process.poll(), 'helper exited before startup interruption')
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), 'mock Docker never reached acquisition window')
                os.killpg(process.pid, interrupt)
                self.finish(process, 128 + interrupt)
                self.assert_clean()


if __name__ == '__main__':
    unittest.main()
