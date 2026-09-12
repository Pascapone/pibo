import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from 'typebox';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { inspectPiboContextBuild } from '../dist/core/context-build.js';
import { inspectPiboProfile } from '../dist/agent-runtimes/pi/runtime.js';
import { validateAgentRuntimeProfileCapabilities } from '../dist/agent-runtime/profile-validation.js';
import { createFakeAgentRuntimeDriver } from '../dist/agent-runtime/testing/fake-adapter.js';
import { resolveRuntimePluginPlan } from '../dist/agent-runtime/plugin-plan.js';
import { buildPluginContextPreview, capturePluginContextBuild, persistPluginContextBuild, inspectPluginBuildContext, exportPluginContextBuild } from '../dist/agent-runtime/plugin-context-build.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { fixture } from './plugin-system-management-helpers.mjs';

function makePlan(installation, kind = 'generation') {
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]) });
  return resolveRuntimePluginPlan({ profile, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, runtime: { adapterId: 'codex-native', instanceId: 'codex-native', capabilities: {} }, kind, piboSessionId: 'ps_a', generation: kind === 'generation' ? 'g1' : undefined });
}

test('legacy Build Context and Pi profile inspection never create runtime, MCP, factories or executable extensions', async () => {
  let effects = 0;
  const profile = new InitialSessionContext({ profileName: 'a', tools: [{ name: 'dynamic', createDefinition() { effects++; throw new Error('factory executed'); } }], mcpServers: ['never-connect'], piPackages: [{ id: 'old-package' }], toolPackages: { goalControl: false } });
  const snapshot = await inspectPiboContextBuild({ profile, cwd: '/tmp', extensionFactories: [() => { effects++; }] });
  const inspection = await inspectPiboProfile({ profile, cwd: '/tmp', extensionFactories: [() => { effects++; }] });
  const caps = createFakeAgentRuntimeDriver().descriptor.capabilities;
  caps.tools.piboManaged = { support: 'mcp', transports: ['streamable-http'] };
  validateAgentRuntimeProfileCapabilities(profile, caps);
  assert.equal(effects, 0); assert.equal(inspection.piPackages[0].active, false);
  assert.equal(snapshot.nodes[0].metadata.kind, 'preview');
  assert.ok(snapshot.nodes.some(n => n.id === 'tool:dynamic' && n.notes.some(note => note.includes('not executed'))));
});

test('actual build persists immutable plan/delivery and all no-context contributions; preview remains separately identified', async t => {
  const f = await fixture(t, { manifest: { contributions: [
    { id: 'read', name: 'notes_read', kind: 'tool', scope: 'agent', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'context', stage: 'tools', description: 'Schema', loading: 'runtime' } },
    { id: 'service', kind: 'service', scope: 'app', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Service has no model effect' } },
  ] } });
  const installation = await f.active(); const plan = makePlan(installation);
  f.store.putGenerationSnapshot({ piboSessionId: 'ps_a', generationId: 'g1', plan, createdAt: new Date().toISOString() });
  const resources = {
    piboSessionId: 'ps_a', sessionGeneration: 'g1',
    getContextContributions: () => [{ id: 'context:user', source: 'managed', label: 'User context', content: 'Visible instructions\nAPI_KEY=do-not-persist' }],
    getInspection: () => ({ piboSessionId: 'ps_a', sessionGeneration: 'g1', adapterId: 'codex-native', runtimeInstanceId: 'codex-native', skills: [{ contributionId: 'skill:user', kind: 'user', name: 'user' }], delivery: [{ contributionId: 'context:user', status: 'delivered', mode: 'developer-message', fidelity: 'equivalent' }, { contributionId: 'skill:user', status: 'delivered', mode: 'materialized', fidelity: 'equivalent' }] }),
  };
  const tool = { name: 'notes_read', title: 'Read', description: 'TOOL SCHEMA ONLY', inputSchema: Type.Object({}), execute: async () => ({ content: [] }) };
  const snapshot = capturePluginContextBuild({ plan, resources, tools: [tool] });
  persistPluginContextBuild(f.store, snapshot);
  assert.equal(snapshot.nodes.find(n => n.id === 'test.notes/service').status, 'no-context');
  assert.equal(snapshot.nodes.find(n => n.id === 'test.notes/read').delivery.mode, 'session-tool-bridge');
  const skill = snapshot.nodes.find(n => n.id === 'runtime/skill:user'); assert.equal(skill.content.visibility, 'inspector'); assert.match(skill.content.unavailableReason, /Progressive/);
  const copy = exportPluginContextBuild(snapshot); assert.match(copy.modelText, /Visible instructions/); assert.ok(!copy.modelText.includes('TOOL SCHEMA ONLY')); assert.ok(!JSON.stringify(copy).includes('do-not-persist')); assert.equal(copy.completeWirePrompt, false);
  assert.ok(Object.isFrozen(snapshot.nodes));
  const previewPlan = makePlan(installation, 'preview'); const preview = buildPluginContextPreview(previewPlan);
  assert.notEqual(preview.snapshotId, snapshot.snapshotId); assert.equal(preview.kind, 'preview'); assert.ok(preview.nodes.every(n => !n.delivery));
  const read = inspectPluginBuildContext({ store: f.store, piboSessionId: 'ps_a' });
  assert.equal(read.actual.snapshotId, snapshot.snapshotId); assert.equal(read.preview, null);
  assert.equal(inspectPluginBuildContext({ store: f.store, piboSessionId: 'ps_b' }).actual, null);
  assert.equal(f.store.listBuildSnapshots('ps_a').length, 1);
});

test('actual capture rejects cross-session and cross-generation resources', async t => {
  const f = await fixture(t); const plan = makePlan(await f.active());
  assert.throws(() => capturePluginContextBuild({ plan, tools: [], resources: { piboSessionId: 'ps_b', sessionGeneration: 'g1' } }), /generation mismatch/);
  assert.throws(() => capturePluginContextBuild({ plan, tools: [], resources: { piboSessionId: 'ps_a', sessionGeneration: 'g2' } }), /generation mismatch/);
});
