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
	buildDevWorkerDockerRunArgs,
	buildWorkerDockerRunArgs,
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
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memorySwap}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=321`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.shmSize}=768m`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.restart}=no`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxFile}=4`));
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
	assert.ok(runLabels.includes('pibo.compute.portBlock=7'));
	assert.ok(runLabels.includes('pibo.compute.worktree=policy'));
	assert.ok(runLabels.includes('pibo.compute.owner=user:test'));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.memorySwap}=3g`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=321`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.shmSize}=768m`));
	assert.ok(runLabels.includes(`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxSize}=12m`));
});
