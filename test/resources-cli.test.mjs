import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildComputeResourceHealth } from '../dist/compute/resource-health.js';
import { buildComputeDiskDiagnostics } from '../dist/compute/docker.js';
import { renderResourceLeasesText, serializeResourceStatus } from '../dist/resources/cli.js';
import {
	applyResourceReapPlan,
	buildResourceReapPlan,
	listActiveResourceLeases,
} from '../dist/resources/lifecycle.js';

const execFileAsync = promisify(execFile);
const cliPath = new URL('../dist/bin/pibo.js', import.meta.url).pathname;

function emptyComputePlan(now = new Date('2026-07-14T00:00:00.000Z')) {
	return {
		createdAt: now.toISOString(),
		options: { includeDev: false, includeStopped: true, includeDirty: true, maxAgeMinutes: 60 },
		items: [],
		summary: { selected: 0, skipped: 0, worktreesPreserved: 0 },
		nextCommands: [],
	};
}

function poolRecord(path, overrides = {}) {
	return {
		statePath: path,
		lockPath: join(dirname(path), 'state.lock'),
		state: {
			workerId: overrides.workerId ?? 'worker-a',
			poolId: overrides.poolId ?? 'default',
			maxBrowserProcesses: 1,
			pid: overrides.pid ?? 999999,
			cdpUrl: 'http://127.0.0.1:4999',
			userDataDir: '/tmp/pibo-managed-browser',
			activeLeaseId: overrides.activeLeaseId,
			activeLeaseCount: overrides.activeLeaseId ? 1 : 0,
			holder: overrides.holder,
			lastUsedAt: overrides.lastUsedAt ?? '2026-07-13T00:00:00.000Z',
			idleExpiresAt: overrides.idleExpiresAt,
			state: overrides.state ?? 'ready',
			cleanupStatus: 'not-attempted',
		},
	};
}

test('root discovery includes resources and resources help exposes only immediate actions', async () => {
	const root = await execFileAsync('node', [cliPath, '--help']);
	assert.match(root.stdout, /^pibo - agent-oriented CLI/m);
	assert.match(root.stdout, /^  resources\s+Inspect and safely reap/m);

	const help = await execFileAsync('node', [cliPath, 'resources', '--help']);
	assert.match(help.stdout, /Commands:/);
	assert.match(help.stdout, /status\|doctor/);
	assert.match(help.stdout, /leases/);
	assert.match(help.stdout, /reap/);
	assert.doesNotMatch(help.stdout, /--max-age-minutes/);
	assert.doesNotMatch(help.stdout, /--browser-pool-root/);
});

test('resource status and active browser-pool leases keep stable text and JSON fields', () => {
	const health = serializeResourceStatus(buildComputeResourceHealth({
		now: new Date('2026-07-14T00:00:00.000Z'),
		workers: [],
		disk: buildComputeDiskDiagnostics([], { now: new Date('2026-07-14T00:00:00.000Z') }),
		processes: [],
		browserPools: [],
		staleCdpFiles: { pidFiles: 0, portFiles: 0, details: [] },
		reaperTimers: { status: 'configured', details: 'fixture', nextCommands: [] },
	}));
	assert.equal(health.readOnly, true);
	assert.equal(health.browserLeases.active, 0);
	assert.equal(health.computeWorkers.total, 0);
	assert.deepEqual(health.nextCommands.slice(0, 3), [
		'pibo resources status --json',
		'pibo resources leases --json',
		'pibo resources reap --dry-run --json',
	]);

	const leases = listActiveResourceLeases([
		poolRecord('/fixture/active/state.json', { activeLeaseId: 'lease-2', holder: 'ralph', idleExpiresAt: '2026-07-14T01:00:00.000Z', state: 'leased' }),
		poolRecord('/fixture/idle/state.json'),
		poolRecord('/fixture/first/state.json', { workerId: 'worker-b', activeLeaseId: 'lease-1', holder: 'agent', idleExpiresAt: '2026-07-14T00:30:00.000Z', state: 'leased' }),
	]);
	assert.deepEqual(leases.map((lease) => lease.leaseId), ['lease-1', 'lease-2']);
	assert.deepEqual(leases[0], {
		leaseId: 'lease-1',
		holder: 'agent',
		workerId: 'worker-b',
		poolId: 'default',
		expiresAt: '2026-07-14T00:30:00.000Z',
		state: 'leased',
	});
	assert.match(renderResourceLeasesText(leases), /LEASE_ID\tHOLDER\tWORKER\/POOL\tEXPIRY\tSTATE/);
	assert.match(renderResourceLeasesText(leases), /lease-2\tralph\tworker-a\/default/);
});

test('resources leases JSON reads only managed browser-pool state fixtures', async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'pibo-resources-leases-'));
	try {
		const root = join(cwd, 'pool-root');
		const statePath = join(root, 'browser-pools', 'worker-cli', 'default', 'state.json');
		await mkdir(dirname(statePath), { recursive: true });
		await writeFile(statePath, `${JSON.stringify(poolRecord(statePath, {
			workerId: 'worker-cli',
			activeLeaseId: 'lease-cli',
			holder: 'fixture-holder',
			idleExpiresAt: '2026-07-14T02:00:00.000Z',
			state: 'leased',
		}).state, null, 2)}\n`);
		const result = await execFileAsync('node', [cliPath, 'resources', 'leases', '--browser-pool-root', root, '--json'], { cwd });
		assert.deepEqual(JSON.parse(result.stdout).leases, [{
			leaseId: 'lease-cli',
			holder: 'fixture-holder',
			workerId: 'worker-cli',
			poolId: 'default',
			expiresAt: '2026-07-14T02:00:00.000Z',
			state: 'leased',
		}]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test('resource reap dry-run aggregates browser, stale-file, and compute plans while preserving worktrees', () => {
	const now = new Date('2026-07-14T00:00:00.000Z');
	const compute = {
		...emptyComputePlan(now),
		summary: { selected: 1, skipped: 1, worktreesPreserved: 1 },
	};
	const plan = buildResourceReapPlan({
		now,
		options: {
			includeDev: false,
			maxAgeMinutes: 60,
			idleTimeoutMinutes: 10,
			browserPoolRoot: '/fixture/pools',
			browserUseHome: '/fixture/browser-use',
		},
		records: [
			poolRecord('/fixture/stale/state.json', { state: 'stale' }),
			poolRecord('/fixture/leased/state.json', { activeLeaseId: 'lease-active', state: 'leased' }),
		],
		staleFiles: [{ path: '/fixture/browser-use/pibo-cdp/dead.pid', kind: 'pid', action: 'remove', reason: 'pid is not alive' }],
		compute,
	});
	assert.equal(plan.dryRun, true);
	assert.equal(plan.browserPools.selected, 1);
	assert.equal(plan.browserPools.skipped, 1);
	assert.equal(plan.staleFiles.selected, 1);
	assert.equal(plan.compute.summary.selected, 1);
	assert.equal(plan.worktreesPreserved, true);
	assert.match(plan.browserPools.items[1].reason, /active lease lease-active/);
});

test('resource reap apply rechecks fixtures, removes only confirmed stale pid/port files, and never touches worktrees', async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'pibo-resources-apply-'));
	try {
		const stateDir = join(cwd, 'browser-use', 'pibo-cdp');
		await mkdir(stateDir, { recursive: true });
		const deadPid = join(stateDir, 'dead.pid');
		const deadPort = join(stateDir, 'dead.port');
		const livePid = join(stateDir, 'live.pid');
		const livePort = join(stateDir, 'live.port');
		await writeFile(deadPid, '999999999\n');
		await writeFile(deadPort, '4999\n');
		await writeFile(livePid, `${process.pid}\n`);
		await writeFile(livePort, '5000\n');

		const now = new Date('2026-07-14T00:00:00.000Z');
		const plan = buildResourceReapPlan({
			now,
			options: {
				includeDev: true,
				maxAgeMinutes: 60,
				idleTimeoutMinutes: 0,
				browserPoolRoot: join(cwd, 'pools'),
				browserUseHome: join(cwd, 'browser-use'),
			},
			records: [poolRecord(join(cwd, 'pools', 'browser-pools', 'worker-a', 'default', 'state.json'), { state: 'stale' })],
			staleFiles: [
				{ path: deadPid, kind: 'pid', action: 'remove', reason: 'fixture dead pid' },
				{ path: livePid, kind: 'pid', action: 'remove', reason: 'stale plan must be rechecked' },
			],
			compute: emptyComputePlan(now),
		});
		let browserCalls = 0;
		let computeCalls = 0;
		const result = await applyResourceReapPlan(plan, {
			plan: async () => plan,
			reapBrowserPool: async () => {
				browserCalls += 1;
				return {
					reaped: true,
					eligible: true,
					reason: 'fixture',
					affectedLeases: 0,
					affectedBrowserPools: 1,
					terminatedProcessTrees: 0,
					staleStateFiles: 0,
					cleanupStatus: 'success',
					state: poolRecord('/fixture/state.json', { state: 'empty' }).state,
				};
			},
			applyCompute: async () => {
				computeCalls += 1;
				return [];
			},
		});

		assert.equal(browserCalls, 1);
		assert.equal(computeCalls, 1);
		assert.equal(result.worktreesPreserved, true);
		await assert.rejects(readFile(deadPid, 'utf8'), /ENOENT/);
		await assert.rejects(readFile(deadPort, 'utf8'), /ENOENT/);
		assert.equal(await readFile(livePid, 'utf8'), `${process.pid}\n`);
		assert.equal(await readFile(livePort, 'utf8'), '5000\n');
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
