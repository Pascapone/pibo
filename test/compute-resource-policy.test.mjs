import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import {
	COMPUTE_RESOURCE_POLICY_ENV,
	COMPUTE_RESOURCE_POLICY_LABELS,
	DEFAULT_COMPUTE_RESOURCE_POLICY,
	buildDockerResourcePolicyArgs,
	resolveComputeResourcePolicy,
} from '../dist/compute/resource-policy.js';
import {
	LABEL_CLEANUP_STATE,
	LABEL_DIRTY_REASON,
	LABEL_IDLE_SECONDS,
	LABEL_LAST_USED_AT,
	LABEL_OWNER_SCOPE,
	LABEL_PORT_BLOCK,
	LABEL_RALPH_JOB_ID,
	LABEL_RALPH_RUN_ID,
	LABEL_TTL_SECONDS,
	LABEL_WORKTREE,
	LABEL_WORKTREE_PATH,
	applyComputeWorkerReapPlan,
	buildComputeDiskDiagnostics,
	buildComputeWorkerReapPlan,
	buildDevWorkerDockerRunArgs,
	buildWorkerDockerRunArgs,
	parseDockerSizeBytes,
	parseDockerSystemDfLines,
	parseDockerWorkerInspect,
	parseDockerWorkerListLine,
	resolveComputeWorkerLifecycle,
} from '../dist/compute/docker.js';
import { renderComputeDiskDiagnosticsText, renderComputeReapPlanText, renderComputeResourceHealthText, renderComputeWorkerListText } from '../dist/compute/cli.js';
import { buildComputeResourceHealth, parseProcessList } from '../dist/compute/resource-health.js';

const customPolicy = Object.freeze({
	memory: '3g',
	memorySwap: '3g',
	pidsLimit: 321,
	shmSize: '768m',
	init: true,
	restart: 'no',
	logDriver: 'json-file',
	logMaxSize: '12m',
	logMaxFile: 4,
});

function valueAfter(args, flag) {
	const index = args.indexOf(flag);
	assert.notEqual(index, -1, `expected ${flag} in ${args.join(' ')}`);
	return args[index + 1];
}

function labels(args) {
	const result = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--label') result.push(args[i + 1]);
	}
	return result;
}

test('compute resource policy resolves safe defaults and documented env overrides', () => {
	assert.deepEqual(resolveComputeResourcePolicy({}), DEFAULT_COMPUTE_RESOURCE_POLICY);

	const policy = resolveComputeResourcePolicy({
		[COMPUTE_RESOURCE_POLICY_ENV.memory]: '4g',
		[COMPUTE_RESOURCE_POLICY_ENV.memorySwap]: '4g',
		[COMPUTE_RESOURCE_POLICY_ENV.pidsLimit]: '900',
		[COMPUTE_RESOURCE_POLICY_ENV.shmSize]: '1g',
		[COMPUTE_RESOURCE_POLICY_ENV.init]: 'false',
		[COMPUTE_RESOURCE_POLICY_ENV.logMaxSize]: '20m',
		[COMPUTE_RESOURCE_POLICY_ENV.logMaxFile]: '5',
	});

	assert.deepEqual(policy, {
		memory: '4g',
		memorySwap: '4g',
		pidsLimit: 900,
		shmSize: '1g',
		init: false,
		restart: 'no',
		logDriver: 'json-file',
		logMaxSize: '20m',
		logMaxFile: 5,
	});
});

test('compute worker lifecycle labels resolve safe defaults and env overrides', () => {
	assert.deepEqual(resolveComputeWorkerLifecycle({}, {}), { ttlSeconds: 3600, idleSeconds: 1800 });
	assert.deepEqual(resolveComputeWorkerLifecycle({ ttlSeconds: 10 }, { PIBO_COMPUTE_TTL_SECONDS: '20', PIBO_COMPUTE_IDLE_SECONDS: '30' }), { ttlSeconds: 10, idleSeconds: 30 });
	assert.deepEqual(resolveComputeWorkerLifecycle({}, { PIBO_COMPUTE_TTL_SECONDS: '90', PIBO_COMPUTE_IDLE_SECONDS: '45' }), { ttlSeconds: 90, idleSeconds: 45 });
});

test('docker resource policy args include memory pids shm init restart and log bounds', () => {
	const args = buildDockerResourcePolicyArgs(customPolicy);
	assert.equal(valueAfter(args, '--memory'), '3g');
	assert.equal(valueAfter(args, '--memory-swap'), '3g');
	assert.equal(valueAfter(args, '--pids-limit'), '321');
	assert.equal(valueAfter(args, '--shm-size'), '768m');
	assert.ok(args.includes('--init'));
	assert.equal(valueAfter(args, '--restart'), 'no');
	assert.equal(valueAfter(args, '--log-driver'), 'json-file');
	assert.ok(args.includes('max-size=12m'));
	assert.ok(args.includes('max-file=4'));
});

test('one-time worker docker run args include resource policy and inspectable labels', () => {
	const args = buildWorkerDockerRunArgs({
		id: 'pibo-worker-test',
		createdAt: '2026-05-17T00:00:00.000Z',
		owner: 'user:test',
		worktreePath: '/repo/worktree',
		ttlSeconds: 7200,
		idleSeconds: 1800,
		ralphJobId: 'ralph-job-1',
		ralphRunId: 'rrun-1',
		policy: customPolicy,
	});

	assert.equal(args[0], 'run');
	assert.equal(valueAfter(args, '--name'), 'pibo-worker-test');
	assert.equal(valueAfter(args, '--memory'), '3g');
	assert.equal(valueAfter(args, '--memory-swap'), '3g');
	assert.equal(valueAfter(args, '--pids-limit'), '321');
	assert.equal(valueAfter(args, '--shm-size'), '768m');
	assert.equal(valueAfter(args, '--restart'), 'no');
	assert.ok(args.includes('--init'));
	assert.ok(args.includes('max-size=12m'));
	assert.ok(args.includes('max-file=4'));
	assert.equal(args.at(-1), 'gateway:web');

	const runLabels = labels(args);
	assert.ok(runLabels.includes('pibo.compute.role=worker'));
	assert.ok(runLabels.includes('pibo.compute.owner=user:test'));
	assert.ok(runLabels.includes(`${LABEL_OWNER_SCOPE}=user:test`));
	assert.ok(runLabels.includes(`${LABEL_WORKTREE}=worktree`));
	assert.ok(runLabels.includes(`${LABEL_WORKTREE_PATH}=/repo/worktree`));
	assert.ok(runLabels.includes(`${LABEL_PORT_BLOCK}=dynamic`));
	assert.ok(runLabels.includes('pibo.compute.port.gateway=4789'));
	assert.ok(runLabels.includes('pibo.compute.port.cdp=56663'));
	assert.ok(runLabels.includes(`${LABEL_TTL_SECONDS}=7200`));
	assert.ok(runLabels.includes(`${LABEL_IDLE_SECONDS}=1800`));
	assert.ok(runLabels.includes(`${LABEL_RALPH_JOB_ID}=ralph-job-1`));
	assert.ok(runLabels.includes(`${LABEL_RALPH_RUN_ID}=rrun-1`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memorySwap}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=321`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.shmSize}=768m`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.restart}=no`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxFile}=4`));
});

test('ralph-owned worker labels omit unsafe prompt-like values', () => {
	const args = buildWorkerDockerRunArgs({
		id: 'pibo-worker-unsafe',
		createdAt: '2026-05-17T00:00:00.000Z',
		owner: 'user:test',
		ralphJobId: 'This is a full prompt with spaces and secrets',
		ralphRunId: 'rrun_safe-1',
		policy: customPolicy,
	});

	const runLabels = labels(args);
	assert.ok(!runLabels.some((label) => label.includes('This is a full prompt')));
	assert.ok(runLabels.includes(`${LABEL_RALPH_RUN_ID}=rrun_safe-1`));
});

test('compute list parsing exposes Ralph ownership from Docker labels', () => {
	const line = [
		'abc123',
		'pibo-dev-ralph-test',
		'exited',
		'Exited (137) 2 minutes ago',
		'0.0.0.0:4830->4789/tcp',
		[
			'pibo.compute.role=dev',
			'pibo.compute.createdAt=2026-05-17T00:00:00.000Z',
			'pibo.compute.ownerScope=user:test',
			'pibo.compute.worktree=ralph-test',
			'pibo.compute.worktreePath=/repo/.worktrees/ralph-test',
			`${LABEL_LAST_USED_AT}=2026-05-17T00:10:00.000Z`,
			'pibo.ralph.jobId=ralph_job_1',
			'pibo.ralph.runId=rrun_1',
			`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=2g`,
			`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=512`,
		].join(','),
	].join('\t');

	const worker = parseDockerWorkerListLine(line);
	assert.equal(worker.id, 'abc123');
	assert.equal(worker.name, 'pibo-dev-ralph-test');
	assert.equal(worker.role, 'dev');
	assert.equal(worker.state, 'exited');
	assert.equal(worker.status, 'Exited (137) 2 minutes ago');
	assert.equal(worker.ports, '0.0.0.0:4830->4789/tcp');
	assert.equal(worker.createdAt, '2026-05-17T00:00:00.000Z');
	assert.equal(worker.lastUsedAt, '2026-05-17T00:10:00.000Z');
	assert.equal(worker.ownerScope, 'user:test');
	assert.equal(worker.worktree, 'ralph-test');
	assert.equal(worker.worktreePath, '/repo/.worktrees/ralph-test');
	assert.equal(worker.ralphJobId, 'ralph_job_1');
	assert.equal(worker.ralphRunId, 'rrun_1');
	assert.deepEqual(worker.resourcePolicy, { memory: '2g', pidsLimit: 512 });
	assert.deepEqual(worker.cleanupEligibility, {
		eligible: false,
		reasons: ['dev-worker-preserved', 'stopped'],
		nextCommands: ['pibo compute reap --include-dev --max-age-minutes <n>'],
	});
});

function inspectFixture(overrides = {}) {
	return {
		Id: overrides.Id ?? 'container-1',
		Name: overrides.Name ?? '/pibo-worker-running',
		Created: overrides.Created ?? '2026-05-17T00:00:00.000Z',
		Config: {
			Labels: {
				'pibo.compute.role': 'worker',
				'pibo.compute.createdAt': '2026-05-17T00:00:00.000Z',
				'pibo.compute.ownerScope': 'user:test',
				'pibo.compute.worktree': 'repo',
				...(overrides.omitPortLabel ? {} : { 'pibo.compute.port.gateway': '4789' }),
				[COMPUTE_RESOURCE_POLICY_LABELS.memory]: '2g',
				[COMPUTE_RESOURCE_POLICY_LABELS.memorySwap]: '2g',
				[COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit]: '512',
				[COMPUTE_RESOURCE_POLICY_LABELS.shmSize]: '512m',
				[COMPUTE_RESOURCE_POLICY_LABELS.restart]: 'no',
				...(overrides.Labels ?? {}),
			},
		},
		State: overrides.State ?? { Status: 'running', Running: true, OOMKilled: false, Dead: false, ExitCode: 0, StartedAt: '2026-05-17T00:01:00.000Z' },
		NetworkSettings: overrides.NetworkSettings ?? { Ports: { '4789/tcp': [{ HostIp: '0.0.0.0', HostPort: '4830' }] } },
	};
}

test('all-state compute inspect parsing covers running stopped OOM-killed and no-port containers', () => {
	const running = parseDockerWorkerInspect(inspectFixture());
	assert.equal(running.state, 'running');
	assert.equal(running.oomKilled, false);
	assert.deepEqual(running.portMap, { '4789/tcp': '0.0.0.0:4830', gateway: '4789' });
	assert.deepEqual(running.cleanupEligibility, { eligible: false, reasons: ['running-or-retained'], nextCommands: ['pibo compute list --all --json'] });

	const stopped = parseDockerWorkerInspect(inspectFixture({ Id: 'container-2', Name: '/pibo-worker-stopped', State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 0 } }));
	assert.equal(stopped.state, 'exited');
	assert.equal(stopped.status, 'exited (0)');
	assert.deepEqual(stopped.cleanupEligibility, { eligible: true, reasons: ['stopped'], nextCommands: ['pibo compute reap --max-age-minutes <n>'] });

	const oom = parseDockerWorkerInspect(inspectFixture({ Id: 'container-3', Name: '/pibo-worker-oom', State: { Status: 'exited', Running: false, OOMKilled: true, Dead: false, ExitCode: 137 } }));
	assert.equal(oom.oomKilled, true);
	assert.deepEqual(oom.cleanupEligibility.reasons, ['oom-killed', 'stopped']);

	const noPort = parseDockerWorkerInspect(inspectFixture({ Id: 'container-4', Name: '/pibo-worker-no-port', State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 1 }, NetworkSettings: { Ports: {} }, omitPortLabel: true }));
	assert.equal(noPort.ports, '-');
});

test('compute list text output has empty state guidance and all-state columns', () => {
	const empty = renderComputeWorkerListText([], { all: true });
	assert.match(empty, /No Pibo worker containers found/);
	assert.match(empty, /pibo compute list --all --json/);
	assert.match(empty, /pibo compute reap --help/);

	const worker = parseDockerWorkerInspect(inspectFixture({ State: { Status: 'exited', Running: false, OOMKilled: true, Dead: false, ExitCode: 137 } }));
	const text = renderComputeWorkerListText([worker], { all: true });
	assert.match(text, /NAME\tROLE\tSTATE\tSTATUS\tOOM\tPORTS/);
	assert.match(text, /pibo-worker-running\tworker\texited\texited \(137\)\tyes/);
	assert.match(text, /gw=4830/);
	assert.doesNotMatch(text, /0\.0\.0\.0:4830->4789\/tcp/);
	assert.match(text, /pibo compute list --all --verbose/);
	assert.match(text, /mem=2g,pids=512,shm=512m/);
	assert.match(text, /eligible:oom-killed\+stopped/);

	const verbose = renderComputeWorkerListText([worker], { all: true, verbose: true });
	assert.match(verbose, /4789\/tcp=0\.0\.0\.0:4830/);
});

function workerFixture(name, overrides = {}) {
	return parseDockerWorkerInspect(inspectFixture({
		Id: overrides.Id ?? name,
		Name: `/${name}`,
		Created: overrides.Created ?? '2026-05-17T00:00:00.000Z',
		Labels: { ...(overrides.Created ? { 'pibo.compute.createdAt': overrides.Created } : {}), ...(overrides.Labels ?? {}) },
		State: overrides.State,
		NetworkSettings: overrides.NetworkSettings,
		omitPortLabel: overrides.omitPortLabel,
	}));
}

test('compute reap dry-run plans selected and skipped workers with worktree preservation', () => {
	const plan = buildComputeWorkerReapPlan([
		workerFixture('pibo-worker-stopped', { State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 0 } }),
		workerFixture('pibo-dev-stopped', { Labels: { 'pibo.compute.role': 'dev', 'pibo.compute.worktreePath': '/repo/.worktrees/dev' }, State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 0 } }),
		workerFixture('pibo-worker-running', { Created: '2026-05-17T00:59:00.000Z', State: { Status: 'running', Running: true, OOMKilled: false, Dead: false, ExitCode: 0 } }),
	], { now: new Date('2026-05-17T01:00:00.000Z'), maxAgeMinutes: 59 });

	assert.equal(plan.summary.selected, 1);
	assert.equal(plan.items.find((item) => item.worker.name === 'pibo-worker-stopped').action, 'remove');
	assert.deepEqual(plan.items.find((item) => item.worker.name === 'pibo-worker-stopped').reasons, ['stopped', 'old']);
	assert.deepEqual(plan.items.find((item) => item.worker.name === 'pibo-dev-stopped').skipReasons, ['dev-worker-preserved']);
	assert.deepEqual(plan.items.find((item) => item.worker.name === 'pibo-worker-running').skipReasons, ['not-selected']);

	const text = renderComputeReapPlanText(plan);
	assert.match(text, /Compute reap dry-run: 1 selected/);
	assert.match(text, /Dry-run only/);
	assert.match(text, /Apply equivalent plan with: pibo compute reap --apply --max-age-minutes 59/);
	assert.match(text, /Review equivalent dry-run with: pibo compute reap --dry-run --max-age-minutes 59/);
	assert.match(text, /Worktrees are preserved/);
});

test('compute reap include-dev, dirty, and max-age selectors choose expected containers', () => {
	const plan = buildComputeWorkerReapPlan([
		workerFixture('pibo-dev-old', { Labels: { 'pibo.compute.role': 'dev', 'pibo.compute.worktreePath': '/repo/.worktrees/dev-old' } }),
		workerFixture('pibo-worker-dirty', { Created: '2026-05-17T01:30:00.000Z', Labels: { [LABEL_CLEANUP_STATE]: 'dirty', [LABEL_DIRTY_REASON]: 'browser cleanup failed' }, State: { Status: 'running', Running: true, OOMKilled: false, Dead: false, ExitCode: 0 } }),
		workerFixture('pibo-worker-oom', { Created: '2026-05-17T01:30:00.000Z', State: { Status: 'exited', Running: false, OOMKilled: true, Dead: false, ExitCode: 137 } }),
	], { includeDev: true, now: new Date('2026-05-17T02:00:00.000Z'), maxAgeMinutes: 60 });

	assert.deepEqual(plan.items.map((item) => [item.worker.name, item.action, item.reasons]), [
		['pibo-dev-old', 'remove', ['old']],
		['pibo-worker-dirty', 'remove', ['dirty']],
		['pibo-worker-oom', 'remove', ['stopped', 'oom-killed']],
	]);
	assert.equal(plan.summary.worktreesPreserved, 1);
	const text = renderComputeReapPlanText(plan);
	assert.match(text, /WARNING: --include-dev selected dev workers/);
	assert.match(text, /--apply --max-age-minutes 60 --include-dev/);
});

test('compute reap apply removes only selected containers and never deletes worktrees', async () => {
	const plan = buildComputeWorkerReapPlan([
		workerFixture('pibo-worker-stopped', { State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 0 } }),
		workerFixture('pibo-dev-stopped', { Labels: { 'pibo.compute.role': 'dev', 'pibo.compute.worktreePath': '/repo/.worktrees/dev' }, State: { Status: 'exited', Running: false, OOMKilled: false, Dead: false, ExitCode: 0 } }),
	], { now: new Date('2026-05-17T01:00:00.000Z'), maxAgeMinutes: 59 });
	const released = [];
	const removed = await applyComputeWorkerReapPlan(plan, { release: async (id) => { released.push(id); } });

	assert.deepEqual(removed, ['pibo-worker-stopped']);
	assert.deepEqual(released, ['pibo-worker-stopped']);
	assert.equal(plan.summary.worktreesPreserved, 0);
	const applied = renderComputeReapPlanText(plan, { applied: true, removed });
	assert.match(applied, /Removed: pibo-worker-stopped/);
	assert.match(applied, /Worktrees are preserved/);
});

test('docker disk diagnostics parse system df JSON rows and render safe cleanup suggestions', () => {
	const rows = parseDockerSystemDfLines([
		JSON.stringify({ Type: 'Images', TotalCount: '2', Active: '1', Size: '1.5GB', Reclaimable: '500MB (33%)' }),
		JSON.stringify({ Type: 'Containers', TotalCount: '4', Active: '2', Size: '20kB', Reclaimable: '10kB (50%)' }),
		JSON.stringify({ Type: 'Local Volumes', TotalCount: '1', Active: '0', Size: '2MB', Reclaimable: '2MB (100%)' }),
		JSON.stringify({ Type: 'Build Cache', TotalCount: '12', Active: '0', Size: '3.25GB', Reclaimable: '3.25GB' }),
	].join('\n'));

	assert.equal(parseDockerSizeBytes('1.5GB'), 1_500_000_000);
	assert.equal(rows.length, 4);
	assert.equal(rows[0].kind, 'images');
	assert.equal(rows[1].kind, 'containers');
	assert.equal(rows[2].kind, 'localVolumes');
	assert.equal(rows[3].kind, 'buildCache');
	assert.equal(rows[3].reclaimableBytes, 3_250_000_000);

	const diagnostics = buildComputeDiskDiagnostics(rows, { now: new Date('2026-05-17T00:00:00.000Z') });
	assert.equal(diagnostics.readOnly, true);
	assert.equal(diagnostics.dockerAvailable, true);
	assert.equal(diagnostics.usage.images.sizeBytes, 1_500_000_000);
	assert.equal(diagnostics.usage.containers.reclaimableBytes, 10_000);
	assert.equal(diagnostics.usage.localVolumes.sizeBytes, 2_000_000);
	assert.equal(diagnostics.usage.buildCache.sizeBytes, 3_250_000_000);
	assert.equal(diagnostics.totals.reclaimableBytes, 3_752_010_000);
	assert.deepEqual(diagnostics.suggestions.map((suggestion) => suggestion.kind), ['container-cleanup', 'image-cleanup', 'build-cache-prune', 'worktree-cleanup']);

	const text = renderComputeDiskDiagnosticsText(diagnostics);
	assert.match(text, /Compute disk diagnostics \(read-only\)/);
	assert.match(text, /Images\t2\t1\t1.5GB\t1500000000\t500MB \(33%\)\t500000000/);
	assert.match(text, /container-cleanup/);
	assert.match(text, /pibo compute reap --dry-run --json/);
	assert.match(text, /image-cleanup/);
	assert.match(text, /docker image prune/);
	assert.match(text, /build-cache-prune/);
	assert.match(text, /docker builder prune/);
	assert.match(text, /worktree-cleanup/);
	assert.match(text, /git worktree prune/);
});

test('docker disk diagnostics render Docker unavailable guidance without cleanup actions', () => {
	const diagnostics = buildComputeDiskDiagnostics([], { dockerAvailable: false, dockerError: 'spawn docker ENOENT', now: new Date('2026-05-17T00:00:00.000Z') });
	const text = renderComputeDiskDiagnosticsText(diagnostics);
	assert.match(text, /Docker unavailable: spawn docker ENOENT/);
	assert.match(text, /pibo compute diagnostics --json/);
});

test('limited worker smoke script dry-runs without creating Docker resources', async () => {
	const { stdout } = await execFileAsync('node', ['scripts/compute-limited-worker-smoke.mjs', '--dry-run', '--json', '--name', 'pibo-worker-policy-smoke-test'], { maxBuffer: 1024 * 1024 });
	const result = JSON.parse(stdout);
	assert.equal(result.status, 'skipped');
	assert.equal(result.readOnly, true);
	assert.match(result.reason, /dry-run/);
	assert.ok(result.plannedCommands.some((command) => command.includes('compute spawn --name pibo-worker-policy-smoke-test')));
	assert.ok(result.plannedCommands.some((command) => command.includes('docker inspect pibo-worker-policy-smoke-test')));
	assert.ok(result.plannedCommands.some((command) => command.includes('/usr/bin/chromium')));
	assert.ok(result.plannedCommands.some((command) => command.includes('compute list --all --json')));
	assert.ok(result.plannedCommands.some((command) => command.includes('compute release pibo-worker-policy-smoke-test')));
});

test('limited worker smoke script skips clearly when Docker is unavailable or apply is not requested', async () => {
	const { stdout } = await execFileAsync('node', ['scripts/compute-limited-worker-smoke.mjs', '--dry-run'], { maxBuffer: 1024 * 1024 });
	assert.match(stdout, /Limited worker smoke skipped:/);
	assert.match(stdout, /pass --apply/);
	assert.match(stdout, /Next: npm run --silent dev -- compute spawn/);
});

test('dev worker docker run args include resource policy labels worktree metadata and bounded logs', () => {
	const args = buildDevWorkerDockerRunArgs({
		id: 'pibo-dev-policy',
		worktreePath: '/repo/.worktrees/policy',
		worktreeName: 'policy',
		block: 7,
		gatewayPort: 4870,
		cdpPort: 4871,
		webPort: 4872,
		webUIPortChat: 4873,
		webUIPortContext: 4874,
		createdAt: '2026-05-17T00:00:00.000Z',
		owner: 'user:test',
		ttlSeconds: 5400,
		idleSeconds: 2700,
		ralphJobId: 'ralph-job-2',
		ralphRunId: 'rrun-2',
		hostNodeModules: '/repo/node_modules',
		policy: customPolicy,
	});

	assert.equal(valueAfter(args, '--name'), 'pibo-dev-policy');
	assert.equal(valueAfter(args, '--memory'), '3g');
	assert.equal(valueAfter(args, '--memory-swap'), '3g');
	assert.equal(valueAfter(args, '--pids-limit'), '321');
	assert.equal(valueAfter(args, '--shm-size'), '768m');
	assert.equal(valueAfter(args, '--restart'), 'no');
	assert.ok(args.includes('--init'));
	assert.ok(args.includes('max-size=12m'));
	assert.ok(args.includes('max-file=4'));
	assert.ok(args.includes('4870:4789'));
	assert.ok(args.includes('/repo/.worktrees/policy:/workspace'));
	assert.ok(args.includes('/repo/node_modules:/workspace/node_modules'));
	assert.equal(args.at(-2), '-c');
	assert.equal(args.at(-1), 'tail -f /dev/null');

	const runLabels = labels(args);
	assert.ok(runLabels.includes('pibo.compute.role=dev'));
	assert.ok(runLabels.includes(`${LABEL_PORT_BLOCK}=7`));
	assert.ok(runLabels.includes(`${LABEL_WORKTREE}=policy`));
	assert.ok(runLabels.includes(`${LABEL_WORKTREE_PATH}=/repo/.worktrees/policy`));
	assert.ok(runLabels.includes('pibo.compute.owner=user:test'));
	assert.ok(runLabels.includes(`${LABEL_OWNER_SCOPE}=user:test`));
	assert.ok(runLabels.includes('pibo.compute.port.gateway=4870'));
	assert.ok(runLabels.includes('pibo.compute.port.cdp=4871'));
	assert.ok(runLabels.includes('pibo.compute.port.chatUi=4873'));
	assert.ok(runLabels.includes(`${LABEL_TTL_SECONDS}=5400`));
	assert.ok(runLabels.includes(`${LABEL_IDLE_SECONDS}=2700`));
	assert.ok(runLabels.includes(`${LABEL_RALPH_JOB_ID}=ralph-job-2`));
	assert.ok(runLabels.includes(`${LABEL_RALPH_RUN_ID}=rrun-2`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memorySwap}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=321`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.shmSize}=768m`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxSize}=12m`));
});

function browserPoolState(overrides = {}) {
	return {
		workerId: overrides.workerId ?? 'worker-a',
		poolId: overrides.poolId ?? 'default',
		maxBrowserProcesses: overrides.maxBrowserProcesses ?? 1,
		pid: overrides.pid,
		processGroupId: overrides.processGroupId,
		cdpUrl: overrides.cdpUrl,
		userDataDir: overrides.userDataDir,
		activeLeaseId: overrides.activeLeaseId,
		activeLeaseCount: overrides.activeLeaseCount,
		owner: overrides.owner,
		lastUsedAt: overrides.lastUsedAt,
		idleExpiresAt: overrides.idleExpiresAt,
		state: overrides.state ?? 'ready',
		cleanupStatus: overrides.cleanupStatus ?? 'success',
		lastError: overrides.lastError,
	};
}

function configuredTimer() {
	return { status: 'configured', details: 'test timer configured', nextCommands: ['pibo compute health --json'] };
}

test('compute resource health reports healthy read-only state with stable JSON fields', () => {
	const health = buildComputeResourceHealth({
		now: new Date('2026-05-17T00:00:00.000Z'),
		workers: [],
		disk: buildComputeDiskDiagnostics([], { now: new Date('2026-05-17T00:00:00.000Z') }),
		processes: [],
		browserPools: [],
		staleCdpFiles: { pidFiles: 0, portFiles: 0, details: [] },
		reaperTimers: configuredTimer(),
	});

	assert.equal(health.readOnly, true);
	assert.equal(health.severity, 'ok');
	assert.equal(health.browserProcesses.totalChromiumProcesses, 0);
	assert.equal(health.browserLeases.active, 0);
	assert.equal(health.computeWorkers.dirty, 0);
	assert.equal(health.computeWorkers.oomKilled, 0);
	assert.equal(health.reaperTimers.status, 'configured');
	assert.ok(health.nextCommands.includes('pibo compute health --json'));

	const text = renderComputeResourceHealthText(health);
	assert.match(text, /Compute resource health: ok \(read-only\)/);
	assert.match(text, /Browser processes: 0 main \/ 0 total/);
});

test('compute resource health warns on browser main-process leaks and active leases', () => {
	const processes = parseProcessList([
		'101 1 101 chromium /usr/bin/chromium --user-data-dir=/tmp/pibo-profile-a --remote-debugging-port=9222',
		'102 1 102 google-chrome /usr/bin/google-chrome --user-data-dir=/tmp/pibo-profile-a --remote-debugging-port=9223',
		'103 101 101 chromium /usr/bin/chromium --type=renderer --user-data-dir=/tmp/pibo-profile-a',
		'104 201 104 chromium /usr/bin/chromium --user-data-dir=/tmp/unmanaged-profile --remote-debugging-port=9333 --token=secret',
	].join('\n'));
	const health = buildComputeResourceHealth({
		workers: [],
		disk: buildComputeDiskDiagnostics([], {}),
		processes,
		browserPools: [{ state: browserPoolState({ workerId: 'worker-a', pid: 101, processGroupId: 101, userDataDir: '/tmp/pibo-profile-a', activeLeaseId: 'lease-a', activeLeaseCount: 1, state: 'leased' }), statePath: '/pool/state.json' }],
		staleCdpFiles: { pidFiles: 1, portFiles: 1, details: ['stale pid file: a.pid', 'orphan port file: a.port'] },
		reaperTimers: configuredTimer(),
	});

	assert.equal(health.severity, 'warning');
	assert.equal(health.browserProcesses.totalChromiumProcesses, 4);
	assert.equal(health.browserProcesses.totalChromiumMainProcesses, 3);
	assert.equal(health.browserProcesses.perWorker[0].browserMainProcessCount, 2);
	assert.equal(health.browserProcesses.unassignedChromiumMainProcesses, 1);
	assert.equal(health.browserProcesses.unassignedMainProcessDetails[0].pid, 104);
	assert.equal(health.browserProcesses.unassignedMainProcessDetails[0].userDataDir, '/tmp/unmanaged-profile');
	assert.match(health.browserProcesses.unassignedMainProcessDetails[0].argsPreview, /token=<redacted>/);
	assert.equal(health.browserLeases.active, 1);
	assert.ok(health.checks.some((check) => check.id === 'browser-leak' && /unmanaged Chromium/.test(check.message)));
	assert.ok(health.checks.some((check) => check.id === 'stale-cdp-files'));
	const text = renderComputeResourceHealthText(health);
	assert.match(text, /Unmanaged browser main processes: 1/);
	assert.match(text, /104\t-\t\/tmp\/unmanaged-profile\tchromium/);
});

test('compute resource health reports dirty workers and OOM containers with cleanup commands', () => {
	const dirty = workerFixture('pibo-worker-dirty-health', { Labels: { [LABEL_CLEANUP_STATE]: 'dirty', [LABEL_DIRTY_REASON]: 'browser cleanup failed' } });
	const oom = workerFixture('pibo-worker-oom-health', { State: { Status: 'exited', Running: false, OOMKilled: true, Dead: false, ExitCode: 137 } });
	const health = buildComputeResourceHealth({
		workers: [dirty, oom],
		disk: buildComputeDiskDiagnostics([], {}),
		processes: [],
		browserPools: [],
		staleCdpFiles: { pidFiles: 0, portFiles: 0, details: [] },
		reaperTimers: configuredTimer(),
	});

	assert.equal(health.severity, 'critical');
	assert.deepEqual(health.computeWorkers.dirtyWorkers, ['pibo-worker-dirty-health']);
	assert.deepEqual(health.computeWorkers.oomKilledWorkers, ['pibo-worker-oom-health']);
	assert.ok(health.checks.some((check) => check.id === 'dirty-workers' && check.nextCommands.includes('pibo compute reap --dry-run --include-dev')));
	assert.ok(health.checks.some((check) => check.id === 'oom-containers' && check.severity === 'critical'));
});

test('compute resource health warns on Docker disk pressure and missing reaper timer state', () => {
	const diskRows = parseDockerSystemDfLines([
		JSON.stringify({ Type: 'Images', TotalCount: '1', Active: '1', Size: '1GB', Reclaimable: '0B' }),
		JSON.stringify({ Type: 'Build Cache', TotalCount: '20', Active: '0', Size: '6GB', Reclaimable: '6GB' }),
	].join('\n'));
	const health = buildComputeResourceHealth({
		workers: [],
		disk: buildComputeDiskDiagnostics(diskRows, {}),
		processes: [],
		browserPools: [],
		staleCdpFiles: { pidFiles: 0, portFiles: 0, details: [] },
	});

	assert.equal(health.severity, 'warning');
	assert.equal(health.dockerDisk.pressure, true);
	assert.equal(health.reaperTimers.status, 'missing');
	assert.ok(health.checks.some((check) => check.id === 'docker-disk-pressure'));
	assert.ok(health.checks.some((check) => check.id === 'reaper-timer'));
	const text = renderComputeResourceHealthText(health);
	assert.match(text, /docker-disk-pressure/);
	assert.match(text, /Reaper\/timer: missing/);
});
