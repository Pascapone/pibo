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

test('legacy facade reads host-owned tools directly and sees teardown without a copied catalog', async () => {
	const { PiboPluginRegistry } = await import('../dist/plugins/registry.js');
	const host = new PluginHost();
	const facade = new PiboPluginRegistry({ host });
	const c = { id: 'tool', kind: 'tool', name: 'owned', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Fixture' } };
	await host.start({ plugins: [plugin('a', ctx => { ctx.register('tool', { name: 'owned', description: 'Fixture', enabled: true }); }, { contributions: [c] })] });
	assert.equal(facade.getCapabilityCatalog().nativeTools.find(t => t.name === 'owned').pluginId, 'a');
	assert.throws(() => facade.registerTool({ name: 'owned' }), /Duplicate/);
	await host.stop();
	assert.equal(facade.getCapabilityCatalog().nativeTools.some(t => t.name === 'owned'), false);
});

test('legacy registration failure rolls back maps and immediately silences its listener; retry and cleanup are owned', async () => {
	const { PiboPluginRegistry } = await import('../dist/plugins/registry.js');
	const facade = new PiboPluginRegistry();
	let broken = true; let events = 0; let retainedApi;
	const p = { id: 'a', register(api) {
		retainedApi = api;
		api.registerTool({ name: 'fixture', pluginId: 'spoofed' });
		api.onEvent(() => { events++; });
		api.registerContextFile({ key: 'owned', path: '/fixture/context.md' });
		if (broken) throw new Error('partial');
	} };
	assert.throws(() => facade.registerPlugin(p), /partial/);
	facade.notifyEvent({ type: 'fixture' });
	assert.equal(events, 0);
	assert.equal(facade.getCapabilityCatalog().nativeTools.length, 0);
	broken = false; facade.registerPlugin(p);
	await Promise.resolve(); await Promise.resolve();
	facade.notifyEvent({ type: 'fixture' }); assert.equal(events, 1);
	assert.equal(facade.getCapabilityCatalog().nativeTools[0].pluginId, 'a');
	await facade.disposePlugins();
	assert.equal(facade.getCapabilityCatalog().nativeTools.length, 0);
	assert.equal(facade.getCapabilityCatalog().contextFiles.length, 0);
	assert.throws(() => retainedApi.registerTool({ name: 'late' }), /disposed/);
});

test('legacy runtime driver/instance registrations roll back synchronously and are released at the owner boundary', async () => {
	const { PiboPluginRegistry } = await import('../dist/plugins/registry.js');
	const { createFakeAgentRuntimeDriver } = await import('../dist/agent-runtime/testing/fake-adapter.js');
	const facade = new PiboPluginRegistry();
	const driver = createFakeAgentRuntimeDriver({ adapterId: 'fixture-runtime' });
	let broken = true;
	const p = { id: 'runtime-fixture', register(api) {
		api.registerAgentRuntimeDriver(driver);
		api.registerAgentRuntimeInstance({ id: 'fixture', adapterId: 'fixture-runtime' });
		if (broken) throw new Error('after runtime registration');
	} };
	assert.throws(() => facade.registerPlugin(p), /after runtime registration/);
	assert.deepEqual(facade.getAgentRuntimeInstanceIds(), []);
	broken = false; facade.registerPlugin(p);
	assert.deepEqual(facade.getAgentRuntimeInstanceIds(), ['fixture']);
	await facade.disposePlugins();
	assert.deepEqual(facade.getAgentRuntimeInstanceIds(), []);
	facade.registerPlugin(p);
	await facade.disposePlugins();
});

test('legacy asynchronous registration cannot mutate the catalog after the registration boundary', async () => {
	const { PiboPluginRegistry } = await import('../dist/plugins/registry.js');
	const facade = new PiboPluginRegistry();
	assert.throws(() => facade.registerPlugin({ id: 'a', async register(api) {
		api.registerTool({ name: 'early' });
		await Promise.resolve();
		api.registerTool({ name: 'late' });
	} }), /must be synchronous/);
	await Promise.resolve(); await Promise.resolve();
	assert.equal(facade.getCapabilityCatalog().nativeTools.length, 0);
});

test('legacy facade does not run tool factories during inventory inspection', async () => {
	const { PiboPluginRegistry } = await import('../dist/plugins/registry.js');
	const facade = new PiboPluginRegistry(); let executions = 0;
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
