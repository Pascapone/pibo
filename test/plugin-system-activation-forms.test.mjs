import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PluginHost } from '../dist/plugins/host.js';
import { startPluginProductRuntime } from '../dist/plugins/product-runtime.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { profileFromPluginPlan } from '../dist/agent-runtime/plugin-plan.js';
import { buildAgentPluginCatalog } from '../dist/apps/chat/chat-capability-routes.js';

const noContext = { kind: 'none', reason: 'fixture' };
const view = (id, scope = 'app') => ({ id, kind: 'view', title: id, scope, required: scope === 'app', defaultEnabled: true, schemaVersion: 1, context: noContext, view: { title: id, exportName: 'View', presentation: scope === 'app' ? 'internal' : 'workspace', instance: 'singleton', mount: 'unmount', stateSchemaVersion: 1 } });
const tool = (id, extra = {}) => ({ id, kind: 'tool', name: id, title: id, scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: noContext, ...extra });

async function source(root, manifest, registrations) {
  const path = join(root, manifest.id); await mkdir(path);
  await writeFile(join(path, 'pibo.plugin.json'), JSON.stringify({ schemaVersion: 1, version: '1.0.0', sdk: '^1.0.0', entrypoints: { backend: 'backend.mjs', browser: 'browser.mjs' }, ...manifest }));
  await writeFile(join(path, 'browser.mjs'), 'export function View() {}');
  await writeFile(join(path, 'backend.mjs'), `export function setup(context) {\n${registrations}\n}`);
  return path;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-activation-forms-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const host = new PluginHost();
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [], installDefaultPlugins: false });
  t.after(() => product.dispose());
  return { root, data, host, product };
}

async function install(f, manifest, registrations) {
  const path = await source(f.root, manifest, registrations);
  await f.product.manager.install({ kind: 'local', path }, { expectedRevision: 0 });
  let installation = f.data.plugins.getInstallation(manifest.id);
  await f.product.manager.activate(manifest.id, { expectedRevision: installation.stateRevision });
  return f.data.plugins.getInstallation(manifest.id);
}

function profile(name, installations) {
  return new InitialSessionContext({ profileName: name, pluginSelection: createAgentPluginSelection(installations) });
}
function disabledProfile(name, installation) {
  const selection = structuredClone(createAgentPluginSelection([installation]));
  selection.plugins[0].enabled = false;
  for (const id of Object.keys(selection.plugins[0].contributions)) selection.plugins[0].contributions[id] = false;
  return new InitialSessionContext({ profileName: name, pluginSelection: selection });
}
const runtime = { adapterId: 'pi', instanceId: 'pi', capabilities: {} };

test('A38 ordinary system-only package survives restart and has no agent selection surface', async t => {
  const f = await fixture(t);
  const installation = await install(f, { id: 'test.system-only', name: 'System only', services: { provides: [{ id: 'test.system.service', version: '1.0.0' }] }, contributions: [view('dashboard')] }, `context.services.provide('test.system.service', { instance: 'system' }); context.register('dashboard', {});`);
  const service = f.host.services.get('test.system.service');
  const catalog = buildAgentPluginCatalog({ schemaVersion: 1, revision: 1, installations: [installation] });
  assert.deepEqual(catalog.plugins, []);
  assert.equal(profileFromPluginPlan(profile('empty', []), f.product.runtime.preview(profile('empty', []), runtime, 'ps_a'), f.host).tools.length, 0);
  assert.equal(f.host.services.get('test.system.service'), service);
  await f.product.dispose();
  const restarted = await startPluginProductRuntime({ host: f.host, data: f.data, artifactRoot: join(f.root, 'artifacts'), collectConsumers: async () => [], installDefaultPlugins: false });
  assert.deepEqual(f.host.services.get('test.system.service'), { instance: 'system' });
  await restarted.dispose();
});

test('A39 ordinary agent-only package is delivered only to the selected agent generation', async t => {
  const f = await fixture(t);
  const installation = await install(f, { id: 'test.agent-only', name: 'Agent only', contributions: [tool('agent_tool')] }, `context.register('agent_tool', { name: 'agent_tool', definition: { name: 'agent_tool', description: 'fixture', inputSchema: { type: 'object' }, async execute(){ return { content: [{ type: 'text', text: 'ok' }] }; } } });`);
  const a = profile('a', [installation]); const b = disabledProfile('b', installation);
  const aPlan = f.product.runtime.preview(a, runtime, 'ps_a'); const bPlan = f.product.runtime.preview(b, runtime, 'ps_b');
  assert.deepEqual(profileFromPluginPlan(a, aPlan, f.host).tools.map((entry) => entry.name), ['agent_tool']);
  assert.deepEqual(profileFromPluginPlan(b, bPlan, f.host).tools, []);
  assert.equal(bPlan.contributions.some((entry) => entry.id === 'test.agent-only/agent_tool'), false);
});

test('A40 ordinary mixed package keeps app view/service active while agent tooling differs', async t => {
  const f = await fixture(t);
  const installation = await install(f, { id: 'test.mixed', name: 'Mixed', services: { provides: [{ id: 'test.mixed.service', version: '1.0.0' }] }, contributions: [view('system-view'), tool('mixed_tool')] }, `context.services.provide('test.mixed.service', { alive: true }); context.register('system-view', {}); context.register('mixed_tool', { name: 'mixed_tool' });`);
  const a = profile('a', [installation]); const b = disabledProfile('b', installation);
  const aPlan = f.product.runtime.preview(a, runtime, 'ps_a'); const bPlan = f.product.runtime.preview(b, runtime, 'ps_b');
  assert.ok(aPlan.contributions.some((entry) => entry.id === 'test.mixed/system-view'));
  assert.ok(bPlan.contributions.some((entry) => entry.id === 'test.mixed/system-view'));
  assert.ok(aPlan.contributions.some((entry) => entry.id === 'test.mixed/mixed_tool'));
  assert.equal(bPlan.contributions.some((entry) => entry.id === 'test.mixed/mixed_tool'), false);
  assert.deepEqual(f.host.services.get('test.mixed.service'), { alive: true });
});

test('A41 missing contribution service or unsupported agent runtime does not remove independent app view', async t => {
  const f = await fixture(t);
  const missing = await install(f, { id: 'test.missing-service', name: 'Missing service', contributions: [view('system-view'), tool('needs_service', { required: true, services: [{ id: 'test.absent', version: '1.0.0' }] })] }, `context.register('system-view', {}); context.register('needs_service', { name: 'needs_service' });`);
  const missingProfile = profile('missing', [missing]);
  const missingPlan = f.product.runtime.preview(missingProfile, runtime, 'ps_missing');
  assert.equal(missingPlan.valid, false);
  assert.ok(missingPlan.diagnostics.some((diagnostic) => diagnostic.code.includes('service')));
  assert.ok(f.host.contributions.get('contribution', 'test.missing-service/system-view'));

  const unsupported = await install(f, { id: 'test.unsupported', name: 'Unsupported', contributions: [view('system-view'), tool('pi_only', { runtime: { adapterIds: ['pi'] } })] }, `context.register('system-view', {}); context.register('pi_only', { name: 'pi_only' });`);
  const unsupportedProfile = profile('unsupported', [unsupported]);
  const plan = f.product.runtime.preview(unsupportedProfile, { adapterId: 'omp', instanceId: 'omp', capabilities: {} }, 'ps_unsupported');
  assert.equal(plan.valid, true);
  assert.ok(plan.contributions.some((entry) => entry.id === 'test.unsupported/system-view'));
  assert.equal(plan.contributions.some((entry) => entry.id === 'test.unsupported/pi_only'), false);
  assert.equal(plan.nodes.find((node) => node.id === 'test.unsupported/pi_only').status, 'unsupported');
});
