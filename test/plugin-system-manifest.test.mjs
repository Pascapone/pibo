import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePluginManifest, validatePluginManifest, validatePluginConfig, satisfiesPluginVersion } from '../dist/plugins/schema.js';
import { PLUGIN_MANIFEST_FILENAME, PLUGIN_SDK_VERSION, qualifyPluginContribution } from '../dist/plugins/sdk.js';

const contribution = () => ({ id: 'notes', kind: 'example.notes', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Only renders notes' } });
const fixture = () => ({ schemaVersion: 1, id: 'example.notes', name: 'Notes', version: '1.0.0', sdk: '^1.0.0', entrypoints: { backend: 'dist/backend.js', browser: 'dist/browser.js' }, services: { provides: [{ id: 'example.notes.storage', version: '1.0.0' }] }, contributions: [contribution()] });

test('manifest: local backend/browser fixture is inspectable without executing either entry', () => {
	const manifest = parsePluginManifest(fixture(), { files: ['dist/backend.js', 'dist/browser.js'] });
	assert.equal(PLUGIN_MANIFEST_FILENAME, 'pibo.plugin.json');
	assert.equal(PLUGIN_SDK_VERSION, '1.0.0');
	assert.equal(qualifyPluginContribution(manifest.id, 'notes'), 'example.notes/notes');
	assert.deepEqual(JSON.parse(JSON.stringify(manifest)), fixture());
	assert.ok(Object.isFrozen(manifest.contributions[0].context));
	assert.throws(() => { manifest.contributions[0].id = 'mutated'; });
});

test('manifest: real local package fixture is inspected while executable entrypoints remain untouched', () => {
	const root = mkdtempSync(join(tmpdir(), 'pibo-manifest-fixture-'));
	try {
		mkdirSync(join(root, 'dist'));
		writeFileSync(join(root, PLUGIN_MANIFEST_FILENAME), JSON.stringify(fixture()));
		for (const entry of ['backend', 'browser']) writeFileSync(join(root, 'dist', `${entry}.js`), 'throw new Error("Entry must not run during inspection");');
		const manifest = parsePluginManifest(JSON.parse(readFileSync(join(root, PLUGIN_MANIFEST_FILENAME), 'utf8')), { files: ['dist/backend.js', 'dist/browser.js'] });
		assert.equal(manifest.id, 'example.notes');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('manifest validates every configuration schema branch, including currently unselected properties', () => {
	const manifest = fixture();
	manifest.config = { schemaVersion: 1, schema: { type: 'object', properties: { hidden: { type: 'string', format: 'unimplemented-format' } } } };
	assert.ok(validatePluginManifest(manifest).some(error => error.code === 'invalid-config-schema'));
});

test('manifest: independent plugin can depend on a service-owned unknown contribution kind', () => {
	const manifest = fixture();
	manifest.services = { requires: [{ id: 'third-party.contract', version: '^1.0.0' }] };
	manifest.contributions[0].kind = 'third-party.future-kind';
	assert.equal(validatePluginManifest(manifest).length, 0);
});

for (const [name, mutate, code] of [
	['unknown manifest schema', m => { m.schemaVersion = 2; }, 'manifest-schema-version'],
	['unknown contribution schema', m => { m.contributions[0].schemaVersion = 2; }, 'contribution-schema-version'],
	['duplicate contribution', m => { m.contributions.push(contribution()); }, 'duplicate-contribution'],
	['missing context effect', m => { delete m.contributions[0].context; }, 'missing-context-effect'],
	['empty no-context reason', m => { m.contributions[0].context.reason = ''; }, 'missing-context-effect'],
	['SDK conflict', m => { m.sdk = '^2.0.0'; }, 'sdk-incompatible'],
	['contradictory dependencies', m => { m.dependencies = [{ id: 'other', version: '^1.0.0' }, { id: 'other', version: '^2.0.0' }]; }, 'duplicate-dependency'],
	['missing local dependency', m => { m.contributions[0].dependsOn = ['example.notes/missing']; }, 'missing-contribution-dependency'],
	['mandatory default disabled', m => { m.contributions[0].required = true; m.contributions[0].defaultEnabled = false; }, 'contradictory-selection'],
	['function in JSON', m => { m.factory = () => {}; }, 'invalid-manifest'],
	['non-finite JSON', m => { m.contributions[0].order = Infinity; }, 'invalid-manifest'],
]) test(`manifest rejects ${name} with structured origin/path`, () => {
	const manifest = fixture(); mutate(manifest);
	const errors = validatePluginManifest(manifest);
	assert.ok(errors.some(error => error.code === code), JSON.stringify(errors));
	assert.equal(errors[0].path[0], 'example.notes');
	assert.throws(() => parsePluginManifest(manifest), /./);
});

for (const path of ['../outside.js', '/absolute.js', 'dist/../../escape.js', 'dist\\escape.js', 'file:evil', 'dist/entry.js?x', 'dist//entry.js']) test(`manifest rejects unsafe entrypoint ${path}`, () => {
	const manifest = fixture(); manifest.entrypoints.backend = path;
	assert.ok(validatePluginManifest(manifest).some(error => error.code === 'invalid-entrypoint'));
});

test('manifest rejects unresolved entries and validates current view/settings metadata', () => {
	const manifest = fixture();
	assert.ok(validatePluginManifest(manifest, { files: [] }).some(error => error.code === 'missing-entrypoint'));
	manifest.contributions[0].view = { title: 'Notes', exportName: 'Notes', presentation: 'workspace', instance: 'singleton', mount: 'unmount', stateSchemaVersion: 1, subviews: [{ id: 'settings', title: 'Settings', purpose: 'settings', settingsScopes: ['app', 'agent', 'session'] }] };
	assert.deepEqual(validatePluginManifest(manifest), []);
	manifest.contributions[0].view.presentation = 'internal';
	assert.ok(validatePluginManifest(manifest).some(error => error.code === 'invalid-view-scope'));
	manifest.contributions[0].view = { ...manifest.contributions[0].view, presentation: 'workspace', visibility: 'session' };
	assert.ok(validatePluginManifest(manifest).some(error => error.code === 'legacy-manifest-field'));
});

test('manifest: supported version ranges do not coerce invalid or prerelease versions', () => {
	assert.equal(satisfiesPluginVersion('1.2.3', '^1.0.0'), true);
	assert.equal(satisfiesPluginVersion('2.0.0', '^1.0.0'), false);
	assert.equal(satisfiesPluginVersion('0.2.9', '^0.2.1'), true);
	assert.equal(satisfiesPluginVersion('0.3.0', '^0.2.1'), false);
	assert.equal(satisfiesPluginVersion('1.2.0', '>=1.0.0 <2.0.0'), true);
	assert.equal(satisfiesPluginVersion('3.0.0', '^1.0.0 || ^3.0.0'), true);
	assert.equal(satisfiesPluginVersion('1.2.0-beta', '^1.0.0'), false);
	assert.equal(satisfiesPluginVersion('nonsense', '*'), false);
	assert.equal(satisfiesPluginVersion('1.0.0-01', '*'), false);
	assert.equal(satisfiesPluginVersion('1.0.0-a..b', '*'), false);
	assert.equal(satisfiesPluginVersion('1.0.0-beta', '1.0.0-beta'), true);
	assert.equal(satisfiesPluginVersion('1.1.0-beta', '^1.0.0-beta'), false);
});

test('config validation is finite JSON, validates transformed values, and fails closed on unsupported keywords', () => {
	const schema = { type: 'object', required: ['limit'], additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 5 }, names: { type: 'array', uniqueItems: true, items: { type: 'string' } } } };
	assert.deepEqual(validatePluginConfig(schema, { limit: 3 }), []);
	for (const value of [{}, { limit: 0 }, { limit: 1, secret: true }, { limit: 1, names: ['a', 'a'] }, { limit: NaN }]) assert.ok(validatePluginConfig(schema, value).length);
	assert.ok(validatePluginConfig({ type: 'string', format: 'uri' }, 'not uri').some(error => error.message.includes('Unsupported')));
	assert.deepEqual(validatePluginConfig({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, 2), []);
});

test('SDK browser boundary contains no Node, harness or old registry import', () => {
	for (const file of ['sdk', 'manifest', 'contributions', 'scope']) {
		const source = readFileSync(new URL(`../src/plugins/${file}.ts`, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /from\s+["'](?:node:|@earendil|.*\/core\/|.*\/registry|.*\/types\.js)/);
	}
});
