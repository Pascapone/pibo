import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import { getSourceHash } from '../dist/compute/docker.js';

const execFileAsync = promisify(execFile);

test('compute spawn reports the loopback host used by its published ports', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'pibo-compute-endpoint-'));
	const fakeBin = join(fixtureRoot, 'bin');
	const fakeHome = join(fixtureRoot, 'home');
	const dockerLog = join(fixtureRoot, 'docker.log');
	const hostnameLog = join(fixtureRoot, 'hostname.log');
	const workspace = process.cwd();

	try {
		await mkdir(join(fakeHome, '.pibo'), { recursive: true });
		await mkdir(fakeBin, { recursive: true });
		await writeFile(join(fakeHome, '.pibo', 'compute-image-hash'), await getSourceHash(workspace));
		await writeFile(join(fakeBin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$PIBO_TEST_DOCKER_LOG"
case "$1" in
  inspect|run) exit 0 ;;
  port)
    case "$3" in
      4789) printf '127.0.0.1:41001\\n' ;;
      56663) printf '127.0.0.1:41002\\n' ;;
      4788) printf '127.0.0.1:41003\\n' ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
`);
		await writeFile(join(fakeBin, 'hostname'), `#!/bin/sh
printf '%s\\n' "$*" >> "$PIBO_TEST_HOSTNAME_LOG"
printf '203.0.113.9\\n'
`);
		await chmod(join(fakeBin, 'docker'), 0o755);
		await chmod(join(fakeBin, 'hostname'), 0o755);

		const { stdout } = await execFileAsync(process.execPath, [
			'dist/bin/pibo.js',
			'compute',
			'spawn',
			'--name',
			'pibo-endpoint-test',
		], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: fakeHome,
				PATH: `${fakeBin}:${process.env.PATH}`,
				PIBO_COMPUTE_WORKSPACE: workspace,
				PIBO_TEST_DOCKER_LOG: dockerLog,
				PIBO_TEST_HOSTNAME_LOG: hostnameLog,
			},
		});

		assert.deepEqual(JSON.parse(stdout), {
			id: 'pibo-endpoint-test',
			image: 'pibo:latest',
			gatewayHost: '127.0.0.1',
			gatewayPort: 41001,
			cdpPort: 41002,
			webPort: 41003,
			connect: 'docker exec -it pibo-endpoint-test bash',
		});
		const dockerCalls = await readFile(dockerLog, 'utf8');
		assert.match(dockerCalls, /-p 127\.0\.0\.1::4789/);
		assert.match(dockerCalls, /-p 127\.0\.0\.1::56663/);
		assert.match(dockerCalls, /-p 127\.0\.0\.1::4788/);
		await assert.rejects(access(hostnameLog), { code: 'ENOENT' });
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});
