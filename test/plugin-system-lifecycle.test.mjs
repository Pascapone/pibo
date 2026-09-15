import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginHost, planPluginActivation } from '../dist/plugins/host.js';
import { PluginScope } from '../dist/plugins/scope.js';
import { PluginContributionRegistry } from '../dist/plugins/services.js';

function plugin(id, setup = () => {}, manifest = {}) {
	return { installation: { pluginId: id, revision: `hash:${id}`, version: '1.0.0', contentHash: `sha256:${id}`, source: { kind: 'builtin', name: id }, createdAt: '2026-09-12T00:00:00Z', state: 'installed', enabled: true, stateRevision: 1, manifest: { schemaVersion: 1, id, name: id, version: '1.0.0', sdk: '^1.0.0', contributions: [], ...manifest } }, setup };
}

test('host validates missing dependencies, cycles and version conflicts before setup effects', async () => {
	let effects = 0;
	for (const plugins of [
		[plugin('a', () => effects++, { dependencies: [{ id: 'missing', version: '^1.0.0' }] })],
		[plugin('a', () => effects++, { dependencies: [{ id: 'b', version: '^1.0.0' }] }), plugin('b', () => effects++, { dependencies: [{ id: 'a', version: '^1.0.0' }] })],
		[plugin('a', () => effects++, { services: { requires: [{ id: 'db', version: '^1.0.0' }] } })],
		[plugin('a', () => effects++, { dependencies: [{ id: 'b', version: '^2.0.0' }] }), plugin('b', () => effects++)],
	]) {
		const host = new PluginHost();
		await assert.rejects(host.start({ plugins }), error => error.diagnostics.every(d => d.path.length > 0));
		assert.equal(host.contributions.list().length, 0);
	}
	assert.equal(effects, 0);
});

test('host deterministically chooses explicit replacement provider and cleans consumers before providers', async () => {
	for (const reverse of [false, true]) {
		const events = [];
		const plugins = [
			plugin('builtin', ctx => { if (ctx.isServiceProvider('db')) ctx.services.provide('db', { name: 'old' }); events.push('builtin'); return () => { events.push('-builtin'); }; }, { services: { provides: [{ id: 'db', version: '1.0.0' }] } }),
			plugin('replacement', ctx => { assert.equal(ctx.services.provide('db', { name: 'new' }), true); events.push('replacement'); return () => { events.push('-replacement'); }; }, { services: { provides: [{ id: 'db', version: '1.0.0', replaces: ['builtin'] }] } }),
			plugin('consumer', ctx => { assert.equal(ctx.services.require('db').name, 'new'); events.push('consumer'); return () => { events.push('-consumer'); }; }, { services: { requires: [{ id: 'db', version: '^1.0.0' }] } }),
		];
		if (reverse) plugins.reverse();
		const host = new PluginHost();
		assert.equal(planPluginActivation({ plugins }).valid, false);
		await host.start({ plugins, providers: { db: 'replacement' } });
		assert.deepEqual(events, ['builtin', 'replacement', 'consumer']);
		const first = host.stop(); assert.equal(host.stop(), first); await first;
		assert.deepEqual(events, ['builtin', 'replacement', 'consumer', '-consumer', '-replacement', '-builtin']);
		assert.deepEqual(host.contributions.list(), []);
		assert.deepEqual(host.services.versions(), {});
	}
});

test('provider choice without a declared replacement does not silently override', async () => {
	const plugins = ['a', 'b'].map(id => plugin(id, () => {}, { services: { provides: [{ id: 'db', version: '1.0.0' }] } }));
	await assert.rejects(new PluginHost().start({ plugins, providers: { db: 'b' } }), /undeclared-service-replacement/);
});

test('partial setup owns resources, listener, timer and service; clean rollback permits retry', async () => {
	const host = new PluginHost();
	const events = [];
	const target = new EventTarget();
	let called = 0;
	let broken = true;
	const p = plugin('a', ctx => {
		ctx.services.provide('db', {});
		ctx.registerResource('route', '/notes', {});
		ctx.register('tool', () => {});
		ctx.scope.listen(target, 'tick', () => called++);
		ctx.scope.interval(() => called++, 100_000);
		ctx.scope.defer(async () => { await Promise.resolve(); events.push('async-cleanup'); });
		if (broken) throw new Error('setup failed');
	}, { services: { provides: [{ id: 'db', version: '1.0.0' }] }, contributions: [{ id: 'tool', kind: 'tool', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'context', stage: 'tools', description: 'Tool schema', loading: 'runtime' } }] });
	await assert.rejects(host.start({ plugins: [p] }), /setup failed/);
	target.dispatchEvent(new Event('tick'));
	assert.equal(called, 0);
	assert.deepEqual(host.contributions.list(), []);
	assert.deepEqual(events, ['async-cleanup']);
	assert.equal(host.inspect().state, 'idle');
	broken = false;
	await host.start({ plugins: [p] });
	assert.equal(host.inspect().state, 'active');
	await host.stop();
});

test('scope disposal is LIFO and once-only, aggregates failures, closes late registration and child sessions', async () => {
	const scope = new PluginScope('a');
	const registry = new PluginContributionRegistry();
	const calls = [];
	registry.register(scope, 'route', '/a', {});
	scope.defer(() => { calls.push('first'); });
	scope.defer(async () => { calls.push('failure'); throw new Error('bad cleanup'); });
	const child = scope.child('ps_a/gen');
	child.defer(() => { calls.push('child'); });
	const one = scope.dispose();
	assert.equal(scope.dispose(), one);
	await assert.rejects(one, AggregateError);
	assert.deepEqual(calls, ['child', 'failure', 'first']);
	assert.equal(scope.status, 'failed');
	assert.equal(scope.signal.aborted, true);
	assert.equal(child.status, 'disposed');
	assert.deepEqual(registry.list(), []);
	assert.throws(() => scope.defer(() => {}), /failed/);
	assert.throws(() => registry.register(scope, 'tool', 'late', {}), /failed/);
});

test('failed cleanup cannot be reported as a stopped or successfully replaced host', async () => {
	const host = new PluginHost();
	await host.start({ plugins: [plugin('a', ctx => { ctx.registerResource('tool', 'a', {}); return () => { throw new Error('stop failed'); }; })] });
	await assert.rejects(host.stop(), /cleanup failed/);
	assert.equal(host.inspect().state, 'failed');
	assert.ok(host.inspect().diagnostics.some(d => d.code === 'cleanup-failed'));
	assert.deepEqual(host.contributions.list(), []);
	await assert.rejects(host.start({ plugins: [plugin('a')] }), /failed/);
	await assert.rejects(host.stop());
});

test('partial activation plus cleanup failure keeps both causes and attempts remaining cleanup', async () => {
	const host = new PluginHost(); const events = [];
	await assert.rejects(host.start({ plugins: [plugin('a', ctx => {
		ctx.scope.defer(() => { events.push('released'); });
		ctx.scope.defer(() => { throw new Error('cleanup'); });
		throw new Error('activation');
	})] }), error => error instanceof AggregateError && error.errors[0].message === 'activation');
	assert.deepEqual(events, ['released']);
	assert.equal(host.inspect().state, 'failed');
});

test('session child scopes do not share generation resources and are stopped before root', async () => {
	const host = new PluginHost(); const events = [];
	await host.start({ plugins: [plugin('a', () => () => { events.push('root'); })] });
	const a = host.createSessionScope('a', 'ps_a', 'gen1');
	const b = host.createSessionScope('a', 'ps_b', 'gen2');
	a.defer(() => { events.push('a'); }); b.defer(() => { events.push('b'); });
	await a.dispose();
	assert.equal(b.status, 'open');
	await host.stop();
	assert.deepEqual(events, ['a', 'b', 'root']);
});

test('host rejects missing or cyclic contribution dependencies before any setup', async () => {
	let effects = 0;
	const c = (id, dependsOn) => ({ id, kind: 'tool', name: id, scope: 'agent', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Fixture' }, dependsOn });
	for (const contributions of [[c('a', ['missing/tool'])], [c('a', ['a/b']), c('b', ['a/a'])]]) {
		await assert.rejects(new PluginHost().start({ plugins: [plugin('a', () => { effects++; }, { contributions })] }), /contribution/);
	}
	assert.equal(effects, 0);
});

test('capability host reads PluginHost-owned tools directly and sees teardown without a copied catalog', async () => {
	const { PiboCapabilityHost } = await import('../dist/core/capability-host.js');
	const host = new PluginHost();
	const facade = new PiboCapabilityHost({ host });
	const c = { id: 'tool', kind: 'tool', name: 'owned', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Fixture' } };
	await host.start({ plugins: [plugin('a', ctx => { ctx.register('tool', { name: 'owned', description: 'Fixture', enabled: true }); }, { contributions: [c] })] });
	assert.equal(facade.getCapabilityCatalog().nativeTools.find(t => t.name === 'owned').pluginId, 'a');
	assert.throws(() => facade.registerTool({ name: 'owned' }), /Duplicate/);
	await host.stop();
	assert.equal(facade.getCapabilityCatalog().nativeTools.some(t => t.name === 'owned'), false);
});

test('capability inventory does not run tool factories', async () => {
	const { PiboCapabilityHost } = await import('../dist/core/capability-host.js');
	const facade = new PiboCapabilityHost(); let executions = 0;
	facade.registerTool({ name: 'dynamic', createDefinition() { executions++; throw new Error('must not execute'); } });
	assert.equal(facade.getCapabilityCatalog().nativeTools[0].portable, false);
	assert.equal(executions, 0);
});

test('undeclared provider, undeclared service use and absent promised services fail closed', async () => {
	for (const p of [plugin('a', ctx => ctx.services.provide('undeclared', {})), plugin('a', ctx => ctx.services.get('undeclared')), plugin('a', () => {}, { services: { provides: [{ id: 'db', version: '1.0.0' }] } })]) {
		const host = new PluginHost();
		await assert.rejects(host.start({ plugins: [p] }), /did not/);
		assert.deepEqual(host.contributions.list(), []);
	}
});

test('incremental plugin lifecycle leaves existing system services alive and rolls back only additions', async () => {
	const host = new PluginHost(); const events = [];
	const system = plugin('system', ctx => { events.push('system-start'); ctx.scope.defer(() => events.push('system-stop')); });
	await host.start({ plugins: [system] });
	await assert.rejects(host.add({ plugins: [plugin('broken', ctx => { ctx.scope.defer(() => events.push('broken-stop')); throw Error('broken'); })] }), /broken/);
	assert.equal(host.inspect().state, 'active');
	assert.deepEqual(host.inspect().plugins.map(p => p.pluginId), ['system']);
	await host.add({ plugins: [plugin('agent')] });
	const child = host.createSessionScope('agent', 'ps_a', 'g1');
	await assert.rejects(host.remove('agent'), /session resources/);
	await child.dispose();
	await host.remove('agent');
	assert.deepEqual(events, ['system-start', 'broken-stop']);
	await host.stop();
	assert.deepEqual(events, ['system-start', 'broken-stop', 'system-stop']);
});

test('app-to-agent dependencies reject before backend effects and provider removal preserves consumers', async () => {
	let effects = 0; const c = { kind: 'service', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'app' } };
	const host = new PluginHost();
	await assert.rejects(host.start({ plugins: [plugin('bad', () => effects++, { contributions: [{ ...c, id: 'app', scope: 'app', dependsOn: ['bad/agent'] }, { ...c, id: 'agent', scope: 'agent' }] })] }));
	assert.equal(effects, 0);
	await host.start({ plugins: [plugin('provider', ctx => { ctx.services.provide('db', {}); }, { services: { provides: [{ id: 'db', version: '1.0.0' }] } })] });
	await host.add({ plugins: [plugin('consumer', () => {}, { services: { requires: [{ id: 'db', version: '^1.0.0' }] } })] });
	await assert.rejects(host.remove('provider'), /consumer/);
	assert.ok(host.services.get('db'));
	await host.remove('consumer'); await host.remove('provider'); await host.stop();
});
