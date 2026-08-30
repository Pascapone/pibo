import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cliPath = resolve('dist/bin/pibo.js');

test('compute release rejects unmanaged targets and pins owned cleanup to the inspected container ID', async () => {
	const dir = join(tmpdir(), `pibo-compute-release-test-${process.pid}-${Date.now()}`);
	const binDir = join(dir, 'bin');
	const logPath = join(dir, 'docker.log');
	await mkdir(binDir, { recursive: true });
	const dockerPath = join(binDir, 'docker');
	await writeFile(dockerPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$PIBO_COMPUTE_RELEASE_TEST_LOG"
command_name="$1"
shift
case "$command_name" in
  inspect)
    case "$PIBO_COMPUTE_RELEASE_FIXTURE" in
      unlabeled) printf '%s\\n' '[{"Id":"full-unlabeled-id","Name":"/sentinel-unlabeled","Config":{"Labels":{}},"State":{"Status":"running"}}]' ;;
      unsupported) printf '%s\\n' '[{"Id":"full-unsupported-id","Name":"/sentinel-unsupported","Config":{"Labels":{"pibo.compute.role":"database"}},"State":{"Status":"running"}}]' ;;
      worker) printf '%s\\n' '[{"Id":"full-worker-id","Name":"/sentinel-worker","Config":{"Labels":{"pibo.compute.role":"worker"}},"State":{"Status":"running"}}]' ;;
      dev-stopped) printf '%s\\n' '[{"Id":"full-dev-id","Name":"/sentinel-dev-stopped","Config":{"Labels":{"pibo.compute.role":"dev"}},"State":{"Status":"exited"}}]' ;;
      missing) echo 'Error: No such object' >&2; exit 1 ;;
    esac
    ;;
  stop)
    [ "$PIBO_COMPUTE_RELEASE_FIXTURE" = 'dev-stopped' ] && exit 1
    [ "$PIBO_COMPUTE_RELEASE_FIXTURE" = 'missing' ] && exit 1
    exit 0
    ;;
  rm)
    [ "$PIBO_COMPUTE_RELEASE_FIXTURE" = 'missing' ] && exit 1
    exit 0
    ;;
  *) echo "unexpected docker command: $command_name" >&2; exit 2 ;;
esac
`);
	await chmod(dockerPath, 0o755);

	const runRelease = (fixture, target) => execFileAsync('node', [cliPath, 'compute', 'release', target], {
		env: {
			...process.env,
			PATH: `${binDir}:${process.env.PATH ?? ''}`,
			PIBO_COMPUTE_RELEASE_FIXTURE: fixture,
			PIBO_COMPUTE_RELEASE_TEST_LOG: logPath,
		},
	});
	const commands = async () => (await readFile(logPath, 'utf8')).trim().split('\n');

	try {
		await assert.rejects(runRelease('unlabeled', 'sentinel-unlabeled'), (error) => {
			assert.match(error.stderr, /Refusing to release Docker container "sentinel-unlabeled"/);
			assert.match(error.stderr, /expected "worker" or "dev"/);
			return true;
		});
		assert.deepEqual(await commands(), ['inspect sentinel-unlabeled']);

		await writeFile(logPath, '');
		await assert.rejects(runRelease('unsupported', 'sentinel-unsupported'), (error) => {
			assert.match(error.stderr, /pibo\.compute\.role="database"/);
			return true;
		});
		assert.deepEqual(await commands(), ['inspect sentinel-unsupported']);

		await writeFile(logPath, '');
		const worker = await runRelease('worker', 'sentinel-worker');
		assert.match(worker.stdout, /Released sentinel-worker/);
		assert.deepEqual(await commands(), ['inspect sentinel-worker', 'stop -t 10 full-worker-id', 'rm full-worker-id']);

		await writeFile(logPath, '');
		const stoppedDev = await runRelease('dev-stopped', 'sentinel-dev-stopped');
		assert.match(stoppedDev.stdout, /Released sentinel-dev-stopped/);
		assert.deepEqual(await commands(), ['inspect sentinel-dev-stopped', 'stop -t 10 full-dev-id', 'rm full-dev-id']);

		await writeFile(logPath, '');
		await assert.rejects(runRelease('missing', 'sentinel-missing'), (error) => {
			assert.match(error.stderr, /Unable to inspect Docker container "sentinel-missing" before release/);
			assert.match(error.stderr, /No container was changed/);
			return true;
		});
		assert.deepEqual(await commands(), ['inspect sentinel-missing']);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
