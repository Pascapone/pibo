import assert from 'node:assert/strict';
import test from 'node:test';

import {
	COMPUTE_RESOURCE_POLICY_ENV,
	COMPUTE_RESOURCE_POLICY_LABELS,
	DEFAULT_COMPUTE_RESOURCE_POLICY,
	buildDockerResourcePolicyArgs,
	resolveComputeResourcePolicy,
} from '../dist/compute/resource-policy.js';
import {
	LABEL_IDLE_SECONDS,
	LABEL_OWNER_SCOPE,
	LABEL_PORT_BLOCK,
	LABEL_RALPH_JOB_ID,
	LABEL_RALPH_RUN_ID,
	LABEL_TTL_SECONDS,
	LABEL_WORKTREE,
	LABEL_WORKTREE_PATH,
	buildDevWorkerDockerRunArgs,
	buildWorkerDockerRunArgs,
	parseDockerWorkerListLine,
	resolveComputeWorkerLifecycle,
} from '../dist/compute/docker.js';

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
		'Exited (137) 2 minutes ago',
		'0.0.0.0:4830->4789/tcp',
		[
			'pibo.compute.role=dev',
			'pibo.compute.createdAt=2026-05-17T00:00:00.000Z',
			'pibo.compute.ownerScope=user:test',
			'pibo.compute.worktree=ralph-test',
			'pibo.compute.worktreePath=/repo/.worktrees/ralph-test',
			'pibo.ralph.jobId=ralph_job_1',
			'pibo.ralph.runId=rrun_1',
		].join(','),
	].join('\t');

	assert.deepEqual(parseDockerWorkerListLine(line), {
		id: 'abc123',
		name: 'pibo-dev-ralph-test',
		role: 'dev',
		status: 'Exited (137) 2 minutes ago',
		ports: '0.0.0.0:4830->4789/tcp',
		createdAt: '2026-05-17T00:00:00.000Z',
		ownerScope: 'user:test',
		worktree: 'ralph-test',
		worktreePath: '/repo/.worktrees/ralph-test',
		ralphJobId: 'ralph_job_1',
		ralphRunId: 'rrun_1',
	});
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
