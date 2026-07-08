import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertGatewayResourceAvailableForWork,
	buildGatewayResourceSnapshot,
	parseHostProcessResourceList,
	renderGatewayResourceSnapshotText,
	resolveGatewayResourceGuardPolicy,
} from '../dist/core/gateway-resource-guard.js';

test('gateway resource guard resolves policy env and blocks only in block mode', () => {
	const policy = resolveGatewayResourceGuardPolicy({
		PIBO_GATEWAY_RESOURCE_GUARD: 'block',
		PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES: '999999999999999',
		PIBO_GATEWAY_MIN_HEAP_AVAILABLE_BYTES: '0',
		PIBO_GATEWAY_MAX_RSS_BYTES: '999999999999999',
	});
	assert.equal(policy.mode, 'block');
	assert.equal(policy.minFreeMemoryBytes, 999999999999999);

	const warnSnapshot = buildGatewayResourceSnapshot({
		env: { PIBO_GATEWAY_RESOURCE_GUARD: 'warn', PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES: '999999999999999' },
		includeProcesses: false,
	});
	assert.equal(warnSnapshot.guardAction, 'warn');
	assert.equal(warnSnapshot.severity, 'critical');

	assert.throws(
		() => assertGatewayResourceAvailableForWork('yielded run test', {
			PIBO_GATEWAY_RESOURCE_GUARD: 'block',
			PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES: '999999999999999',
		}),
		/Gateway resource guard blocked yielded run test before starting/,
	);

	assert.doesNotThrow(() => assertGatewayResourceAvailableForWork('yielded run test', {
		PIBO_GATEWAY_RESOURCE_GUARD: 'warn',
		PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES: '999999999999999',
	}));
});

test('gateway resource process parsing exposes children and known heavy daemons', () => {
	const output = [
		' 100 1 50000 node node dist/bin/pibo.js gateway web',
		' 101 100 25000 python python worker.py --token secret=abc',
		' 200 1 3145728 python.exe python main.py --auto-launch --listen 127.0.0.1 --port 8188',
		' 300 1 4194304 Unity.exe Unity Editor',
	].join('\n');
	const rows = parseHostProcessResourceList(output, 100, {
		mode: 'warn',
		minFreeMemoryBytes: 1,
		minHeapAvailableBytes: 1,
		maxRssBytes: 999999999,
		knownDaemonWarningRssBytes: 2 * 1024 * 1024 * 1024,
	});
	assert.deepEqual(rows.map((row) => [row.pid, row.kind, row.label]), [
		[100, 'gateway', undefined],
		[101, 'child', undefined],
		[300, 'known-daemon', 'Unity'],
		[200, 'known-daemon', 'ComfyUI'],
	]);
	assert.match(rows.find((row) => row.pid === 101).args, /--token <redacted>/);

	const snapshot = buildGatewayResourceSnapshot({
		env: { PIBO_GATEWAY_KNOWN_DAEMON_WARNING_RSS_BYTES: String(2 * 1024 * 1024 * 1024) },
		processListOutput: output,
	});
	assert.equal(snapshot.processes.available, true);
	assert.equal(snapshot.processes.children.length, 0);
	assert.equal(snapshot.processes.knownDaemons.length, 2);
	assert.ok(snapshot.checks.some((check) => check.id === 'known-heavy-daemons'));
	assert.match(renderGatewayResourceSnapshotText(snapshot), /knownDaemons=2/);
});
