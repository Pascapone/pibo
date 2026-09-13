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
import { createWebSearchToolProfile } from '../dist/tools/web-search.js';

function makePlan(installation, kind = 'generation') {
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]) });
  return resolveRuntimePluginPlan({ profile, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, runtime: { adapterId: 'codex-native', instanceId: 'codex-native', capabilities: {} }, kind, piboSessionId: 'ps_a', generation: kind === 'generation' ? 'g1' : undefined });
}

test('plugin-selected Build Context preview and Pi profile inspection never create runtime, MCP, factories or executable extensions', async () => {
  let effects = 0;
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: { schemaVersion: 1, plugins: [] }, tools: [{ name: 'dynamic', createDefinition() { effects++; throw new Error('factory executed'); } }], mcpServers: ['never-connect'], toolPackages: { goalControl: false } });
  const snapshot = await inspectPiboContextBuild({ profile, cwd: '/tmp', extensionFactories: [() => { effects++; }] });
  const inspection = await inspectPiboProfile({ profile, cwd: '/tmp', extensionFactories: [() => { effects++; }] });
  const caps = createFakeAgentRuntimeDriver().descriptor.capabilities;
  caps.tools.piboManaged = { support: 'mcp', transports: ['streamable-http'] };
  validateAgentRuntimeProfileCapabilities(profile, caps);
  assert.equal(effects, 0); assert.equal('piPackages' in inspection, false);
  assert.equal(snapshot.nodes[0].metadata.kind, 'preview');
  assert.ok(snapshot.nodes.some(n => n.id === 'tool:dynamic' && n.notes.some(note => note.includes('not executed'))));
});

test('actual plugin-selected build preserves context, progressive-skill and provider evidence without inventing a wire prompt', async t => {
  const f = await fixture(t, { manifest: { contributions: [
    { id: 'read', name: 'notes_read', kind: 'tool', scope: 'agent', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'context', stage: 'tools', description: 'Schema', loading: 'runtime' } },
    { id: 'web-search', name: 'web_search', kind: 'tool', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'context', stage: 'provider-tools', description: 'Provider search', loading: 'runtime' } },
    { id: 'service', kind: 'service', scope: 'app', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Service has no model effect' } },
  ] } });
  const installation = await f.active();
  const profile = new InitialSessionContext({
    profileName: 'a',
    pluginSelection: createAgentPluginSelection([installation]),
    tools: [createWebSearchToolProfile({ allowedDomains: ['example.com'], searchContextSize: 'low' })],
  });
  const plan = resolveRuntimePluginPlan({ profile, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, runtime: { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, kind: 'generation', piboSessionId: 'ps_a', generation: 'g1' });
  f.store.putGenerationSnapshot({ piboSessionId: 'ps_a', generationId: 'g1', plan, createdAt: new Date().toISOString() });
  const resources = {
    piboSessionId: 'ps_a', sessionGeneration: 'g1',
    getContextContributions: () => [
      { id: 'context:session', source: 'generated', label: 'Runtime session context', content: 'App context: app\nPibo Session ID: ps_a\nPibo Room ID: room_a' },
      { id: 'context:user', source: 'managed', label: 'User context', content: 'Visible instructions\nAPI_KEY=do-not-persist' },
    ],
    getInspection: () => ({ piboSessionId: 'ps_a', sessionGeneration: 'g1', adapterId: 'pi', runtimeInstanceId: 'pi', skills: [{ contributionId: 'skill:user', kind: 'user', name: 'user' }], delivery: [
      { contributionId: 'context:session', status: 'delivered', mode: 'system-prompt', fidelity: 'equivalent' },
      { contributionId: 'context:user', status: 'delivered', mode: 'system-prompt', fidelity: 'equivalent' },
      { contributionId: 'skill:user', status: 'delivered', mode: 'materialized', fidelity: 'equivalent' },
    ] }),
  };
  const tool = { name: 'notes_read', title: 'Read', description: 'TOOL SCHEMA ONLY', inputSchema: Type.Object({}), execute: async () => ({ content: [] }) };
  const snapshot = capturePluginContextBuild({ plan, resources, tools: [tool], profile });
  persistPluginContextBuild(f.store, snapshot);
  assert.equal(snapshot.nodes.find(n => n.id === 'test.notes/service').status, 'no-context');
  assert.equal(snapshot.nodes.find(n => n.id === 'test.notes/read').delivery.mode, 'direct');
  const sessionContext = snapshot.nodes.find(n => n.id === 'runtime/context:session');
  assert.match(sessionContext.content.text, /App context: app/); assert.match(sessionContext.content.text, /Pibo Session ID: ps_a/); assert.doesNotMatch(sessionContext.content.text, /User ID|ownerScope|Principal/);
  const skill = snapshot.nodes.find(n => n.id === 'runtime/skill:user'); assert.equal(skill.content.visibility, 'inspector'); assert.match(skill.content.unavailableReason, /Progressive/);
  const provider = snapshot.nodes.find(n => n.id === 'runtime/provider:web_search');
  assert.equal(provider.delivery.mode, 'provider-extension'); assert.equal(provider.content.visibility, 'inspector'); assert.match(provider.content.text, /example\.com/); assert.match(provider.content.text, /searchContextSize/);
  const copy = exportPluginContextBuild(snapshot); assert.match(copy.modelText, /Visible instructions/); assert.match(copy.modelText, /Pibo Session ID: ps_a/); assert.ok(!copy.modelText.includes('TOOL SCHEMA ONLY')); assert.ok(!copy.modelText.includes('example.com')); assert.ok(!JSON.stringify(copy).includes('do-not-persist')); assert.equal(copy.completeWirePrompt, false);
  assert.equal(snapshot.nodes.some(n => /final prompt|full prompt/i.test(n.fallback)), false);
  assert.ok(Object.isFrozen(snapshot.nodes));
  const previewPlan = resolveRuntimePluginPlan({ profile, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, runtime: { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, kind: 'preview', piboSessionId: 'ps_a' });
  const preview = buildPluginContextPreview(previewPlan);
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
