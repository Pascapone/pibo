import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentPluginSelection, validateAgentPluginSelection } from '../dist/plugins/selection.js';
import { resolvePluginContributions, assertEffectivePluginPlan } from '../dist/plugins/resolution.js';

const none = { kind: 'none', reason: 'No model context' };
const context = { kind: 'context', stage: 'tools', description: 'Tool schema', loading: 'runtime' };
function contribution(id, extra = {}) { return { id, kind: 'tool', name: id, scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context, ...extra }; }
function installation(id = 'a', contributions = [contribution('tool')]) {
	return { pluginId: id, revision: `${id}:v1`, version: '1.0.0', contentHash: `sha256:${id}`, source: { kind: 'builtin', name: id }, state: 'active', enabled: true, stateRevision: 1, createdAt: '2026-09-12T00:00:00Z', manifest: { schemaVersion: 1, id, name: id, version: '1.0.0', sdk: '^1.0.0', contributions } };
}
function input(installations = [installation()], options = {}) {
	return { catalog: { schemaVersion: 1, revision: 1, installations }, selection: createAgentPluginSelection(installations), selectionRevision: 2, runtime: { adapterId: 'pi', instanceId: 'pi-default', capabilities: { tools: { direct: true } } }, ...options };
}
const mutable = value => structuredClone(value);

test('selection is a pure explicit snapshot and defaults are not silently read on subsequent resolution', () => {
	const request = input();
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, true); assert.equal(plan.kind, 'preview');
	assert.deepEqual(plan.contributions.map(c => c.id), ['a/tool']);
	assert.ok(Object.isFrozen(plan.contributions[0].contribution.context));
	assert.equal(Object.isFrozen(request.catalog.installations[0]), false);
	const updated = mutable(request);
	updated.catalog.installations[0].manifest.contributions.push(contribution('new-write'));
	const result = resolvePluginContributions(updated);
	assert.deepEqual(result.contributions.map(c => c.id), ['a/tool']);
	assert.equal(result.nodes.find(n => n.id === 'a/new-write').selected, false);
	assert.deepEqual(result.selection, request.selection);
});

test('mandatory contributions cannot be disabled or omitted by an API payload', () => {
	for (const omitted of [false, true]) {
		const request = mutable(input([installation('a', [contribution('required', { required: true })])]));
		if (omitted) delete request.selection.plugins[0].contributions.required;
		else request.selection.plugins[0].contributions.required = false;
		const plan = resolvePluginContributions(request);
		assert.equal(plan.valid, false);
		assert.ok(plan.diagnostics.some(d => d.code === (omitted ? 'new-required-contribution' : 'required-contribution-disabled')));
		assert.throws(() => assertEffectivePluginPlan(plan));
		assert.equal(plan.nodes[0].status, 'required-conflict');
	}
});

test('disabling the whole plugin disables even required agent contributions without touching infrastructure', () => {
	const request = mutable(input([installation('a', [contribution('required', { required: true }), contribution('infrastructure', { scope: 'app', context: none })])]));
	request.selection.plugins[0].enabled = false;
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.contributions.map(c => c.id), ['a/infrastructure']);
	assert.equal(plan.nodes.find(n => n.id === 'a/required').status, 'disabled');
});

test('optional Pi-only is omitted under Codex/OMP; required Pi-only blocks without any implementation import', () => {
	for (const adapterId of ['codex-native', 'omp']) for (const required of [false, true]) {
		const request = input([installation('a', [contribution('portable'), contribution('pi-only', { runtime: { adapterIds: ['pi'] }, required })])], { runtime: { adapterId, instanceId: adapterId, capabilities: {} } });
		const plan = resolvePluginContributions(request);
		assert.equal(plan.valid, !required);
		assert.deepEqual(plan.contributions.map(c => c.id), ['a/portable']);
		assert.equal(plan.nodes.find(n => n.id === 'a/pi-only').status, required ? 'required-conflict' : 'unsupported');
	}
});

test('required dependency propagation blocks an optional unsupported prerequisite with a complete path', () => {
	const request = input([installation('a', [contribution('entry', { required: true, dependsOn: ['a/private'] }), contribution('private', { runtime: { adapterIds: ['pi'] } })])], { runtime: { adapterId: 'omp', instanceId: 'omp', capabilities: {} } });
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, false);
	assert.deepEqual(plan.contributions, []);
	assert.ok(plan.diagnostics.some(d => d.code === 'runtime-unsupported' && d.path.join(' -> ') === 'a/entry -> a/private'));
});

test('explicit optional dependency disabling is honored, not switched back on', () => {
	const request = mutable(input([installation('a', [contribution('entry', { dependsOn: ['a/dependency'] }), contribution('dependency')])]));
	request.selection.plugins[0].contributions.dependency = false;
	const plan = resolvePluginContributions(request);
	assert.deepEqual(plan.contributions, []);
	assert.equal(plan.valid, true);
	assert.ok(plan.diagnostics.some(d => d.code === 'contribution-dependency-unavailable'));
	assert.equal(plan.selection.plugins[0].contributions.dependency, false);
});

test('selected dependency cycles fail with the dependency path', () => {
	const request = input([installation('a', [contribution('one', { dependsOn: ['a/two'] }), contribution('two', { dependsOn: ['a/one'] })])]);
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, false);
	assert.ok(plan.diagnostics.some(d => d.code === 'contribution-cycle' && d.path.length === 3));
	assert.deepEqual(plan.contributions, []);
});

test('new mandatory update and changed artifact semantics demand explicit migration without altering old generation', () => {
	const request = input();
	const old = resolvePluginContributions({ ...request, kind: 'generation', piboSessionId: 'ps_a', generation: 'g1' });
	const updated = mutable(request);
	updated.catalog.installations[0].revision = 'a:v2';
	updated.catalog.installations[0].manifest.contributions.push(contribution('new-required', { required: true }));
	let plan = resolvePluginContributions(updated);
	assert.equal(plan.valid, false);
	assert.ok(plan.diagnostics.some(d => d.code === 'selection-revision-migration-required'));
	updated.acceptedRevisions = { a: ['a:v1'] };
	plan = resolvePluginContributions(updated);
	assert.equal(plan.valid, false);
	assert.ok(plan.diagnostics.some(d => d.code === 'new-required-contribution'));
	assert.deepEqual(old.contributions.map(c => c.id), ['a/tool']);
	assert.equal(old.plugins[0].revision, 'a:v1');
	assert.equal(old.generation, 'g1');
});

test('missing plugin drafts are retained and retiring installations reject new generation dependencies', () => {
	const request = input();
	const missing = resolvePluginContributions({ ...request, catalog: { ...request.catalog, installations: [] } });
	assert.equal(missing.valid, false);
	assert.deepEqual(missing.selection, request.selection);
	assert.equal(missing.nodes[0].status, 'unknown');
	for (const state of ['retiring', 'failed', 'uninstalled', 'staged']) {
		const next = mutable(request); next.catalog.installations[0].state = state;
		assert.equal(resolvePluginContributions(next).valid, false, state);
	}
});

test('overlapping tool names require explicit selected provider and declared replacement, independent of order', () => {
	const a = installation('a', [contribution('tool', { name: 'shared' })]);
	const b = installation('b', [contribution('replacement', { name: 'shared', replaces: ['a/tool'] })]);
	for (const installations of [[a, b], [b, a]]) {
		const request = input(installations);
		assert.equal(resolvePluginContributions(request).valid, false);
		const plan = resolvePluginContributions({ ...request, providers: { 'tool:shared': 'b/replacement' } });
		assert.equal(plan.valid, true);
		assert.deepEqual(plan.contributions.map(c => c.id), ['b/replacement']);
		assert.equal(plan.nodes.find(n => n.id === 'a/tool').status, 'replaced');
	}
});

test('mixed inspector inventory includes every selected and excluded contribution plus independent resources', () => {
	const a = installation('a', [contribution('required', { required: true }), contribution('disabled', { defaultEnabled: false }), contribution('skill', { kind: 'skill', context: { kind: 'context', stage: 'skills', description: 'Progressive skill', loading: 'progressive' } })]);
	const b = installation('b', [contribution('ui', { kind: 'view', context: none }), contribution('mcp', { kind: 'mcp', services: [{ id: 'mcp', version: '^1.0.0' }] })]);
	b.manifest.services = { provides: [{ id: 'mcp', version: '1.0.0' }] };
	const resource = { id: 'user:notes', kind: 'context', name: 'notes', origin: 'user', reference: '/user/notes.md', order: 5, context: { kind: 'context', stage: 'context', description: 'User notes', loading: 'eager' } };
	const manual = { id: 'manual:reviewer', kind: 'subagent', name: 'reviewer', origin: 'manual', reference: 'profile:reviewer', context, metadata: { model: 'chosen', timeoutMs: 1000 } };
	const plan = resolvePluginContributions(input([a, b], { services: { mcp: '1.0.0' }, resources: [resource, manual, { ...resource, id: 'user:duplicate' }] }));
	assert.equal(plan.valid, true);
	assert.equal(plan.nodes.length, 9);
	assert.equal(plan.nodes.find(n => n.id === 'a/disabled').status, 'disabled');
	assert.equal(plan.nodes.find(n => n.id === 'b/ui').status, 'no-context');
	assert.equal(plan.nodes.find(n => n.id === 'a/skill').context.loading, 'progressive');
	assert.equal(plan.nodes.find(n => n.id === 'user:duplicate').status, 'deduplicated');
	assert.deepEqual(plan.resources, [resource, manual]);
	assert.ok(plan.nodes.every(n => n.context && n.status && !n.delivery));
});

test('different user content with equal name and plugin/user collisions fail rather than overwrite', () => {
	const resources = [1, 2].map(n => ({ id: `user:${n}`, kind: 'skill', name: 'same', origin: 'user', reference: `/user/${n}`, context }));
	assert.equal(resolvePluginContributions(input([], { resources })).valid, false);
	const a = installation('a', [contribution('tool', { kind: 'skill', name: 'same' })]);
	assert.equal(resolvePluginContributions(input([a], { resources: [resources[0]] })).valid, false);
});

test('schema validation rejects malformed selections and invalid plugin configuration', () => {
	assert.ok(validateAgentPluginSelection({ schemaVersion: 1, plugins: [{ pluginId: 'a' }] }).length);
	assert.throws(() => resolvePluginContributions({ ...input(), selection: { schemaVersion: 2, plugins: [] } }));
	const request = mutable(input());
	request.catalog.installations[0].manifest.config = { schemaVersion: 1, schema: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } } };
	assert.equal(resolvePluginContributions(request).valid, false);
});

test('runtime capability and external service requirements distinguish optional and mandatory failures', () => {
	const request = input([installation('a', [contribution('delivery', { runtime: { capabilities: ['tools.mcp'], deliveryModes: ['mcp'] } }), contribution('service', { required: true, services: [{ id: 'missing', version: '^1.0.0' }] })])]);
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, false);
	assert.deepEqual(plan.contributions, []);
	assert.ok(plan.diagnostics.some(d => d.code === 'runtime-unsupported' && d.severity === 'warning'));
	assert.ok(plan.diagnostics.some(d => d.code === 'contribution-service-unavailable' && d.severity === 'error'));
});

test('effective configuration has deterministic scopes and refuses foreign session/agent targets', () => {
	const request = mutable(input());
	request.agentId = 'agent-a'; request.piboSessionId = 'ps_a';
	request.selection.plugins[0].config = { value: 'selection', selected: true };
	request.configurations = [
		{ target: { scope: 'session', pluginId: 'a', piboSessionId: 'ps_a' }, revision: 4, schemaVersion: 1, values: { value: 'session' } },
		{ target: { scope: 'app', pluginId: 'a' }, revision: 1, schemaVersion: 1, values: { value: 'app', shared: true } },
		{ target: { scope: 'agent', pluginId: 'a', agentId: 'agent-a' }, revision: 3, schemaVersion: 1, values: { value: 'agent' } },
	];
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.pluginConfigurations.a, { value: 'session', selected: true, shared: true });
	request.configurations[0].target.piboSessionId = 'ps_b';
	assert.equal(resolvePluginContributions(request).valid, false);
	assert.equal(plan.pluginConfigurations.a.value, 'session');
});

test('unnamed replaceable shell providers require explicit composition, never load order', () => {
	const a = installation('a', [contribution('shell', { kind: 'shell', name: undefined, context: none })]);
	const b = installation('b', [contribution('shell', { kind: 'shell', name: undefined, context: none, replaces: ['a/shell'] })]);
	delete a.manifest.contributions[0].name; delete b.manifest.contributions[0].name;
	assert.equal(resolvePluginContributions(input([a, b])).valid, false);
	const plan = resolvePluginContributions(input([b, a], { providers: { shell: 'b/shell' } }));
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.contributions.map(c => c.id), ['b/shell']);
});

test('empty agent selection still validates plugin dependencies, without turning dependency tools on', () => {
	const a = installation('a', []);
	a.manifest.dependencies = [{ id: 'b', version: '^1.0.0' }];
	const b = installation('b');
	const request = input([a, b], { selection: createAgentPluginSelection([a]) });
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.contributions, []);
	assert.deepEqual(plan.plugins.map(p => p.pluginId), ['a', 'b']);
	b.manifest.dependencies = [{ id: 'a', version: '^1.0.0' }];
	assert.ok(resolvePluginContributions(request).diagnostics.some(d => d.code === 'plugin-dependency-cycle'));
});

test('accepted optional-only revision updates retain the exact tool set and do not use new defaults', () => {
	const request = mutable(input());
	request.catalog.installations[0].revision = 'a:v2';
	request.catalog.installations[0].manifest.contributions.push(contribution('new-writer'));
	request.acceptedRevisions = { a: ['a:v1'] };
	const plan = resolvePluginContributions(request);
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.contributions.map(c => c.id), ['a/tool']);
});

test('generation identity cannot be omitted or replaced with room/profile identity', () => {
	const plan = resolvePluginContributions({ ...input(), kind: 'generation' });
	assert.equal(plan.valid, false);
	assert.ok(plan.diagnostics.some(d => d.code === 'missing-generation-identity'));
});


test('service infrastructure pins unselected provider revisions without enabling their agent tools', () => {
  for (const manifestRequirement of [true, false]) {
    const a = installation('consumer', [contribution('read', { required: true, ...(manifestRequirement ? {} : { services: [{ id: 'database', version: '^1.0.0' }] }) })]);
    if (manifestRequirement) a.manifest.services = { requires: [{ id: 'database', version: '^1.0.0' }] };
    const b = installation('provider', [contribution('dangerous-write')]);
    b.manifest.services = { provides: [{ id: 'database', version: '1.0.0' }] };
    const plan = resolvePluginContributions(input([a, b], { selection: createAgentPluginSelection([a]), services: { database: '1.0.0' } }));
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.plugins.map(p => [p.pluginId, p.revision]), [['consumer', 'consumer:v1'], ['provider', 'provider:v1']]);
    assert.deepEqual(plan.contributions.map(c => c.id), ['consumer/read']);
    assert.equal(plan.nodes.find(n => n.id === 'provider/dangerous-write').selected, false);
    assert.equal(plan.nodes.find(n => n.id === 'service:database').pluginRevision, 'provider:v1');
  }
});

test('service replacements require the same explicit host choice and pin only its actual revision', () => {
  const a = installation('consumer', [contribution('read', { required: true, services: [{ id: 'database', version: '^1.0.0' }] })]);
  const b = installation('old', [contribution('old-write')]);
  const c = installation('replacement', [contribution('new-write')]);
  b.manifest.services = { provides: [{ id: 'database', version: '1.0.0' }] };
  c.manifest.services = { provides: [{ id: 'database', version: '1.0.0', replaces: ['old'] }] };
  const request = input([a, b, c], { selection: createAgentPluginSelection([a]), services: { database: '1.0.0' } });
  assert.equal(resolvePluginContributions(request).valid, false);
  const plan = resolvePluginContributions({ ...request, serviceProviders: { database: 'replacement' } });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.plugins.map(p => p.pluginId), ['consumer', 'replacement']);
  assert.deepEqual(plan.contributions.map(c => c.id), ['consumer/read']);
  const missingOwner = resolvePluginContributions(input([a], { services: { database: '1.0.0' } }));
  assert.equal(missingOwner.valid, false);
  assert.ok(missingOwner.diagnostics.some(d => d.code === 'service-owner-unavailable'));
});
