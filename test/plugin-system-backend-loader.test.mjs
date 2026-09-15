import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PluginHost } from '../dist/plugins/host.js';
import { handoffPluginSdkResolutionAtStoppedBoundary, startInstalledPlugins, preparePluginSdkResolution } from '../dist/plugins/backend-loader.js';
import { createStagedPluginDefinition } from '../dist/plugins/staged-definition.js';
import { LocalPluginSourceResolver, stagePluginSource } from '../dist/plugins/sources.js';

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'pibo-plugin-loader-'));
	const artifacts = join(root, 'artifacts');
	t.after(() => rm(root, { recursive: true, force: true }));
	return {
		root, artifacts,
		async plugin(id, code, extra = {}) {
			const source = join(root, id); await mkdir(source);
			const manifest = { schemaVersion: 1, id, name: id, version: '1.0.0', sdk: '^1.0.0', entrypoints: { backend: 'backend.mjs' }, contributions: [], ...extra };
			await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify(manifest));
			await writeFile(join(source, 'backend.mjs'), code);
			const resolved = await new LocalPluginSourceResolver().resolve({ kind: 'local', path: source });
			const artifact = await stagePluginSource(resolved, artifacts, '2026-09-12T00:00:00.000Z');
			return { ...artifact, enabled: true, state: 'installed', stateRevision: 1 };
		},
	};
}

test('installed definition and invalid graph inspection never import executable entries', async t => {
	const f = await fixture(t); const key = `plugin-loader-${randomUUID()}`;
	const plugin = await f.plugin('test.inspect', `globalThis[${JSON.stringify(key)}] = true; export function setup() {}`, { dependencies: [{ id: 'test.missing', version: '^1.0.0' }] });
	const definition = createStagedPluginDefinition(plugin);
	assert.equal(globalThis[key], undefined);
	assert.equal(definition.installation.pluginId, plugin.pluginId);
	await assert.rejects(startInstalledPlugins(new PluginHost(), [plugin]), /missing-plugin-dependency/);
	assert.equal(globalThis[key], undefined);
});

test('all artifact hashes are verified before even the first backend import', async t => {
	const f = await fixture(t); const key = `plugin-loader-${randomUUID()}`;
	const a = await f.plugin('test.a', `globalThis[${JSON.stringify(key)}] = true; export function setup() {}`);
	const b = await f.plugin('test.b', 'export function setup() {}');
	await chmod(join(b.artifactPath, 'backend.mjs'), 0o600);
	await writeFile(join(b.artifactPath, 'backend.mjs'), 'throw new Error("tampered");');
	const host = new PluginHost();
	await assert.rejects(startInstalledPlugins(host, [a, b]), /content hash changed/);
	assert.equal(globalThis[key], undefined);
	assert.equal(host.inspect().state, 'idle');
});

test('installed backend resolves the public SDK and shares the actual host ownership scope', async t => {
	const f = await fixture(t);
	const plugin = await f.plugin('test.sdk', `import { PLUGIN_SDK_VERSION } from '@pasko70/pibo/plugin-sdk'; export function setup(ctx) { ctx.register('status', { version: PLUGIN_SDK_VERSION }); }`, {
		contributions: [{ id: 'status', kind: 'test-value', scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Fixture value only' } }],
	});
	await preparePluginSdkResolution(f.artifacts);
	await preparePluginSdkResolution(f.artifacts);
	const host = new PluginHost();
	await startInstalledPlugins(host, [plugin]);
	assert.equal(host.contributions.list('contribution')[0].value.value.version, '1.0.0');
	assert.equal(host.contributions.list('contribution')[0].owner, plugin.pluginId);
	await host.stop();
	assert.deepEqual(host.contributions.list(), []);
});

test('invalid installed backend export rolls back earlier plugin resources', async t => {
	const f = await fixture(t);
	const a = await f.plugin('test.a', `export function setup(ctx) { ctx.registerResource('fixture', 'a', 1); }`);
	const b = await f.plugin('test.b', `export const setup = 42;`);
	const host = new PluginHost();
	await assert.rejects(startInstalledPlugins(host, [a, b]), /must export setup/);
	assert.deepEqual(host.contributions.list(), []);
	assert.equal(host.inspect().state, 'idle');
});

test('SDK ownership changes only through the explicit stopped-boundary handoff', async t => {
	const f = await fixture(t);
	const oldPackage = join(f.root, 'old-runtime'); await mkdir(oldPackage);
	const newPackage = join(f.root, 'new-runtime'); await mkdir(newPackage);
	const destination = join(f.artifacts, 'node_modules', '@pasko70', 'pibo');
	await preparePluginSdkResolution(f.artifacts, oldPackage);
	await assert.rejects(preparePluginSdkResolution(f.artifacts, newPackage), /another package/);
	assert.equal(await realpath(destination), await realpath(oldPackage));

	const host = new PluginHost();
	await host.start({ plugins: [] });
	await assert.rejects(handoffPluginSdkResolutionAtStoppedBoundary(f.artifacts, host, newPackage), /idle\/stopped/);
	assert.equal(await realpath(destination), await realpath(oldPackage));
	await host.stop();

	await handoffPluginSdkResolutionAtStoppedBoundary(f.artifacts, host, newPackage);
	await handoffPluginSdkResolutionAtStoppedBoundary(f.artifacts, host, newPackage);
	assert.equal(await realpath(destination), await realpath(newPackage));
	await preparePluginSdkResolution(f.artifacts, newPackage);
});
