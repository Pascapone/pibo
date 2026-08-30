import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const spawnFixture = resolve('test/fixtures/compute-dev-spawn-child.mjs');
const fakeDockerFixture = resolve('test/fixtures/fake-compute-docker.mjs');

async function createHarness(t) {
	const root = await mkdtemp(join(tmpdir(), 'pibo-compute-dev-port-test-'));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const baseRepo = join(root, 'base');
	const binDir = join(root, 'bin');
	const piboHome = join(root, 'pibo-home');
	const statePath = join(root, 'docker-state.json');
	await mkdir(baseRepo, { recursive: true });
	await mkdir(binDir, { recursive: true });
	await mkdir(piboHome, { recursive: true });
	await execFileAsync('git', ['init', '--quiet'], { cwd: baseRepo });
	await execFileAsync('git', ['config', 'user.name', 'Pibo Test'], { cwd: baseRepo });
	await execFileAsync('git', ['config', 'user.email', 'pibo-test@example.invalid'], { cwd: baseRepo });
	await writeFile(join(baseRepo, 'README.md'), 'fixture\n', 'utf8');
	await execFileAsync('git', ['add', 'README.md'], { cwd: baseRepo });
	await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: baseRepo });
	await copyFile(fakeDockerFixture, join(binDir, 'docker'));
	await chmod(join(binDir, 'docker'), 0o755);

	const env = {
		...process.env,
		PATH: `${binDir}:${process.env.PATH}`,
		PIBO_HOME: piboHome,
		PIBO_TEST_DOCKER_STATE: statePath,
		PIBO_TEST_DOCKER_PS_DELAY_MS: '75',
		PIBO_TEST_DOCKER_RUN_DELAY_MS: '75',
	};

	async function resetDockerState(runningBlocks = []) {
		await writeFile(statePath, JSON.stringify({ runningBlocks, workers: [] }), 'utf8');
	}

	async function cloneRepo(name) {
		const repo = join(root, name);
		await execFileAsync('git', ['clone', '--quiet', baseRepo, repo]);
		return repo;
	}

	function spawnWorker(repo, name, overrides = {}) {
		const child = spawn(process.execPath, [spawnFixture, repo, name], {
			env: { ...env, ...overrides },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return new Promise((resolvePromise, rejectPromise) => {
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk) => { stdout += chunk; });
			child.stderr.on('data', (chunk) => { stderr += chunk; });
			child.once('error', rejectPromise);
			child.once('close', (code) => {
				if (code !== 0) {
					rejectPromise(new Error(`spawn fixture exited ${code}: ${stderr}`));
					return;
				}
				resolvePromise(JSON.parse(stdout));
			});
		});
	}

	return { root, piboHome, statePath, resetDockerState, cloneRepo, spawnWorker };
}

test('parallel compute dev spawns reserve distinct port blocks across processes', async (t) => {
	const harness = await createHarness(t);
	await harness.resetDockerState();
	const [repoA, repoB] = await Promise.all([harness.cloneRepo('parallel-a'), harness.cloneRepo('parallel-b')]);
	const [resultA, resultB] = await Promise.all([
		harness.spawnWorker(repoA, 'parallel-a'),
		harness.spawnWorker(repoB, 'parallel-b'),
	]);

	assert.equal(resultA.ok, true);
	assert.equal(resultB.ok, true);
	assert.notEqual(resultA.worker.id, resultB.worker.id);
	assert.deepEqual([resultA.worker.gatewayPort, resultB.worker.gatewayPort].sort(), [4800, 4810]);
	await assert.rejects(readFile(join(harness.piboHome, 'compute', 'dev-port-allocation.lock'), 'utf8'), { code: 'ENOENT' });
});

test('staggered and sequential compute dev spawns retain distinct allocation', async (t) => {
	const harness = await createHarness(t);
	await harness.resetDockerState();
	const [repoA, repoB, repoC] = await Promise.all([
		harness.cloneRepo('stagger-a'),
		harness.cloneRepo('stagger-b'),
		harness.cloneRepo('sequential-c'),
	]);
	const first = harness.spawnWorker(repoA, 'stagger-a');
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
	const second = harness.spawnWorker(repoB, 'stagger-b');
	const [resultA, resultB] = await Promise.all([first, second]);
	const resultC = await harness.spawnWorker(repoC, 'sequential-c');

	assert.deepEqual([resultA, resultB, resultC].map((result) => result.ok), [true, true, true]);
	assert.deepEqual([resultA.worker.gatewayPort, resultB.worker.gatewayPort, resultC.worker.gatewayPort].sort(), [4800, 4810, 4820]);
});

test('existing containers remain allocated and a failed spawn releases the reservation', async (t) => {
	const harness = await createHarness(t);
	await harness.resetDockerState([0]);
	const [existingRepo, failedRepo, retryRepo] = await Promise.all([
		harness.cloneRepo('existing'),
		harness.cloneRepo('failed'),
		harness.cloneRepo('retry'),
	]);
	const existingControl = await harness.spawnWorker(existingRepo, 'existing-control');
	assert.equal(existingControl.ok, true);
	assert.equal(existingControl.worker.gatewayPort, 4810);

	await harness.resetDockerState();
	const failedName = 'pibo-dev-forced-failure';
	const failed = await harness.spawnWorker(failedRepo, 'forced-failure', { PIBO_TEST_DOCKER_FAIL_NAME: failedName });
	assert.equal(failed.ok, false);
	assert.match(failed.error, /forced docker run failure/);
	const lockPath = join(harness.piboHome, 'compute', 'dev-port-allocation.lock');
	await assert.rejects(readFile(lockPath, 'utf8'), { code: 'ENOENT' });
	await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, token: 'abandoned', createdAt: '2026-01-01T00:00:00.000Z' }), 'utf8');

	const retry = await harness.spawnWorker(retryRepo, 'after-failure');
	assert.equal(retry.ok, true);
	assert.equal(retry.worker.gatewayPort, 4800);
	await assert.rejects(readFile(lockPath, 'utf8'), { code: 'ENOENT' });
});
