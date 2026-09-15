import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PluginHost } from '../dist/plugins/host.js';
import { PluginManager } from '../dist/plugins/manager.js';
import { PiboCapabilityHost } from '../dist/core/capability-host.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { profileFromPluginPlan } from '../dist/agent-runtime/plugin-plan.js';
import { startPluginProductRuntime } from '../dist/plugins/product-runtime.js';
import { builtinProfilesPackageManifest } from '../dist/plugins/default-packages.js';
import { PIBO_LOOP_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, PIBO_USER_RESOURCES_SERVICE, PLUGIN_HOST_SERVICE, PLUGIN_MANAGEMENT_SERVICE, PLUGIN_SESSION_PLAN_SERVICE } from '../dist/plugins/product-services.js';
import { WebAnnotationStore } from '../dist/web-annotations/index.js';

async function stagedInstallation(t, data, root) {
  const source = join(root, 'source'); await mkdir(source);
  const manifest = { schemaVersion: 1, id: 'test.runtime', name: 'Runtime fixture', version: '1.0.0', sdk: '^1.0.0', entrypoints: { backend: 'backend.mjs' }, contributions: [{ id: 'read', kind: 'tool', name: 'runtime_read', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'test' } }] };
  await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'backend.mjs'), `export function setup(context){ context.register('read', { name: 'runtime_read', description: 'fixture' }); }`);
  const manager = new PluginManager({ store: data.plugins, artifactRoot: join(root, 'artifacts') });
  await manager.install({ kind: 'local', path: source }, { expectedRevision: 0 });
  const installed = data.plugins.getInstallation('test.runtime');
  data.plugins.putInstallation({ ...installed, enabled: true, state: 'active', updatedAt: new Date().toISOString() }, installed.stateRevision);
  return data.plugins.getInstallation('test.runtime');
}

async function stagedLegacyProductUi(data, artifactRoot, { enabled = true } = {}) {
  const source = join(artifactRoot, 'default-sources', 'pibo.product-ui', '1.0.0');
  await mkdir(source, { recursive: true });
  const legacyView = (id, title, exportName) => ({
    id, kind: 'view', title, scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1,
    context: { kind: 'none', reason: 'legacy product view' },
    view: { title, exportName, presentation: 'workspace', instance: 'singleton', mount: 'unmount', stateSchemaVersion: 1, stateSchema: { type: 'object', additionalProperties: true } },
  });
  const manifest = {
    schemaVersion: 1,
    id: 'pibo.product-ui',
    name: 'Legacy Pibo Product Views',
    version: '1.0.0',
    sdk: '^1.0.0',
    entrypoints: { backend: 'backend.mjs', browser: 'browser.mjs' },
    contributions: [legacyView('workflows', 'Workflows', 'WorkflowsView'), legacyView('cron', 'Cron', 'CronView'), legacyView('loops', 'Loops', 'LoopsView'), legacyView('agent-designer', 'Agent Designer', 'AgentDesignerView'), { ...legacyView('settings', 'Settings', 'GlobalSettingsView'), view: { ...legacyView('settings', 'Settings', 'GlobalSettingsView').view, subviews: [{ id: 'general', title: 'General', purpose: 'content' }] } }],
  };
  await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'backend.mjs'), 'export function setup(context) { context.register("settings", {}); }\n');
  await writeFile(join(source, 'browser.mjs'), 'export { AgentDesignerView, GlobalSettingsView, WorkflowsView, CronView, LoopsView } from "/apps/chat/assets/pibo-builtin-plugin.js?v=1.0.0";\n');
  const manager = new PluginManager({ store: data.plugins, artifactRoot });
  await manager.install({ kind: 'local', path: source }, { expectedRevision: 0 });
  const installed = data.plugins.getInstallation(manifest.id);
  return data.plugins.putInstallation({ ...installed, enabled, state: enabled ? 'active' : 'installed', updatedAt: new Date().toISOString() }, installed.stateRevision);
}

test('product runtime starts persisted plugins and publishes one manager/host/session-plan service', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-runtime-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  await stagedInstallation(t, data, root);
  const host = new PluginHost();
  const expectedPlan = { plan: { marker: true } };
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [], readSessionPlan: async () => expectedPlan, includeWebProduct: true });
  assert.equal(host.inspect().state, 'active');
  assert.equal(host.services.get(PLUGIN_HOST_SERVICE), host);
  assert.equal(host.services.get(PLUGIN_MANAGEMENT_SERVICE), product.manager);
  assert.deepEqual(host.services.get(PIBO_PRODUCT_OPTIONS_SERVICE), {});
  assert.deepEqual(await host.services.get(PLUGIN_SESSION_PLAN_SERVICE)('ps_a', 'preview'), expectedPlan);
  assert.equal(host.contributions.get('contribution', 'test.runtime/read').installation.revision, data.plugins.getInstallation('test.runtime').revision);
  const annotations = data.plugins.getInstallation('pibo.web-annotations');
  assert.equal(annotations.state, 'active');
  assert.equal(annotations.source.kind, 'local');
  assert.ok(annotations.artifactPath);
  assert.equal(host.contributions.get('contribution', 'pibo.web-annotations/web_annotations_list').contribution.kind, 'tool');
  assert.equal(host.contributions.get('contribution', 'pibo.web-annotations/annotations').contribution.view.exportName, 'WebAnnotationsView');
  assert.equal(data.plugins.getInstallation('pibo.core'), undefined, 'Core capabilities are host-owned, not a plugin installation');
  for (const pluginId of ['pibo.preview', 'pibo.cron', 'pibo.workflows', 'pibo.code-runtime', 'pibo.file-editing', 'pibo.web-search', 'pibo.browser-tools', 'pibo.codex-compat', 'pibo.run-control', 'pibo.goal-control', 'pibo.agent-delegation', 'pibo.runtime-pi', 'pibo.runtime-codex-native', 'pibo.runtime-omp']) {
    const installation = data.plugins.getInstallation(pluginId);
    assert.equal(installation.state, 'active', `${pluginId} should be an ordinary active installation`);
    assert.equal(installation.source.kind, 'local');
  }
  const projection = PiboCapabilityHost.create({ host });
  assert.deepEqual(projection.getAgentRuntimeInstanceIds().sort(), ['codex-native', 'omp-native', 'pi']);
  assert.deepEqual(projection.getProfileNames(), ['base', 'pibo-gateway-producer', 'codex-native', 'orp']);
  assert.ok(projection.getWebApps().some((app) => app.name === 'web-annotations'));
  assert.equal(host.services.owners()[PIBO_LOOP_SERVICE], 'pibo.goal-control');
  assert.equal(host.contributions.list('contribution').find((entry) => entry.key === 'pibo.runtime-codex-native/approval-response')?.owner, 'pibo.runtime-codex-native');
  assert.equal(host.contributions.list('contribution').find((entry) => entry.key === 'pibo.runtime-codex-native/user-input-response')?.owner, 'pibo.runtime-codex-native');
  assert.equal(host.services.get(PIBO_LOOP_SERVICE).get(), undefined);
  assert.ok(projection.getChannels().some((channel) => channel.name === 'pibo.loop'));
  assert.ok(projection.getGatewayAction('goal'));
  assert.equal(projection.getLoopStopConditionInfos().length, 4);
  assert.equal(host.contributions.get('contribution', 'pibo.workflows/view').contribution.view.exportName, 'WorkflowsView');
  assert.equal(host.contributions.get('contribution', 'pibo.cron/view').contribution.view.exportName, 'CronView');
  assert.equal(host.contributions.get('contribution', 'pibo.goal-control/loops').contribution.view.exportName, 'LoopsView');
  assert.equal(host.contributions.get('contribution', 'pibo.runtime-codex-native/runtime-requests').contribution.view.exportName, 'RuntimeRequestsView');
  assert.equal(host.contributions.get('contribution', 'pibo.product-ui/agent-designer'), undefined);
  assert.equal(host.contributions.get('contribution', 'pibo.product-ui/settings'), undefined);
  assert.equal(data.plugins.getInstallation('pibo.standard-shell'), undefined);
  const profile = new InitialSessionContext({ profileName: 'annotations-agent', pluginSelection: createAgentPluginSelection([annotations]) });
  const plan = product.runtime.preview(profile, { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, 'ps_annotations');
  assert.equal(plan.valid, true);
  assert.ok(plan.contributions.some((entry) => entry.id === 'pibo.web-annotations/annotations'));
  assert.ok(plan.contributions.some((entry) => entry.id === 'pibo.workflows/view'));
  assert.equal(plan.contributions.some((entry) => entry.id === 'pibo.runtime-codex-native/runtime-requests'), false, 'Pi sessions do not receive the Codex Runtime Requests view');
  assert.equal(plan.contributions.some((entry) => entry.id === 'pibo.product-ui/agent-designer'), false);
  assert.equal(plan.contributions.some((entry) => entry.id === 'pibo.product-ui/settings'), false);
  assert.equal(plan.contributions.some((entry) => entry.id === 'pibo.standard-shell/shell'), false);
  const codexAdapter = projection.getAgentRuntimeAdapter('codex-native');
  const codexInstallation = data.plugins.getInstallation('pibo.runtime-codex-native');
  const codexProfile = new InitialSessionContext({ profileName: 'codex-requests', runtimeInstanceId: 'codex-native', pluginSelection: createAgentPluginSelection([codexInstallation]) });
  const codexPlan = product.runtime.preview(codexProfile, { adapterId: 'codex-native', instanceId: 'codex-native', capabilities: codexAdapter.descriptor.capabilities }, 'ps_codex_requests');
  assert.equal(codexPlan.valid, true);
  assert.ok(codexPlan.contributions.some((entry) => entry.id === 'pibo.runtime-codex-native/runtime-requests'));
  assert.deepEqual(profileFromPluginPlan(profile, plan, host).tools.map((tool) => tool.name).filter((name) => name.startsWith('web_annotations_')).sort(), ['web_annotations_acknowledge', 'web_annotations_dismiss', 'web_annotations_get', 'web_annotations_list', 'web_annotations_resolve', 'web_annotations_watch']);
  assert.equal(product.manager.diagnose().consumerCollectorAvailable, true);
  await product.dispose();
  assert.equal(host.inspect().state, 'idle');
  const restarted = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [], readSessionPlan: async () => expectedPlan });
  assert.equal(data.plugins.getInstallation('pibo.web-annotations').stateRevision, annotations.stateRevision);
  assert.equal(host.inspect().plugins.filter((plugin) => plugin.pluginId === 'pibo.web-annotations').length, 1);
  await restarted.dispose();
});

test('Core exposes auth, base Web, Chat, and user resources with zero plugin installations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-core-web-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const host = new PluginHost();
  const product = await startPluginProductRuntime({
    host,
    data,
    artifactRoot: join(root, 'artifacts'),
    installDefaultPlugins: false,
    collectConsumers: async () => [],
    productOptions: {
      web: { authMode: 'dev-auth', channel: { landingAppName: 'pibo.chat-web' }, chat: { dataStorePath: join(root, 'chat.sqlite'), dataPayloadRootDir: join(root, 'chat-payloads') } },
    },
  });
  t.after(() => product.dispose());
  const registry = PiboCapabilityHost.create({ host });
  assert.deepEqual(data.plugins.listInstallations(), []);
  assert.equal(registry.getAuthService()?.name, 'dev-auth');
  assert.ok(registry.getChannels().some((channel) => channel.name === 'web-host'));
  assert.ok(registry.getWebApps().some((app) => app.name === 'pibo.chat-web'));
  assert.equal(host.services.owners()[PIBO_USER_RESOURCES_SERVICE], '@pibo/core');
});

test('user resources are Core-owned without an installation and support dynamic updates without shadowing built-ins', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-user-resources-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const host = new PluginHost();
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [], productOptions: { userResources: { contextFilesMode: 'catalog', userSkills: { globalRoot: join(root, 'global'), workspaceRoot: join(root, 'workspace') } } } });
  const resources = host.services.get(PIBO_USER_RESOURCES_SERVICE);
  assert.equal(host.services.owners()[PIBO_USER_RESOURCES_SERVICE], '@pibo/core');
  assert.equal(data.plugins.getInstallation('pibo.user-resources'), undefined);
  resources.upsertSkill({ name: 'fixture-skill', path: join(root, 'fixture-skill.md'), enabled: true, kind: 'user' });
  resources.upsertSkill({ name: 'skill-creator', path: join(root, 'shadow.md'), enabled: true, kind: 'user' });
  resources.upsertContextFile({ key: 'fixture-context', label: 'Fixture context', path: join(root, 'context.md') });
  resources.upsertProfile({ name: 'fixture-profile', aliases: ['fixture-alias'], create: () => new InitialSessionContext({ profileName: 'fixture-profile' }) });
  const projection = PiboCapabilityHost.create({ host });
  assert.equal(projection.getCapabilityCatalog().skills.find((skill) => skill.name === 'fixture-skill')?.kind, 'user');
  assert.equal(projection.getCapabilityCatalog().skills.find((skill) => skill.name === 'skill-creator')?.kind, 'builtin');
  assert.equal(projection.getCapabilityCatalog().contextFiles.some((file) => file.key === 'fixture-context'), true);
  assert.equal(projection.resolveProfileName('fixture-alias'), 'fixture-profile');
  resources.removeSkill('fixture-skill'); resources.removeContextFile('fixture-context'); resources.removeProfile('fixture-profile');
  assert.equal(projection.getCapabilityCatalog().skills.some((skill) => skill.name === 'fixture-skill'), false);
  assert.equal(projection.getCapabilityCatalog().contextFiles.some((file) => file.key === 'fixture-context'), false);
  await product.dispose();
  assert.equal(host.inspect().state, 'idle');
});

test('normal startup rejects an active legacy Product UI installation until prepared cutover', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-default-upgrade-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const artifactRoot = join(root, 'artifacts');
  const legacy = await stagedLegacyProductUi(data, artifactRoot);
  assert.ok(legacy.manifest.contributions.some((contribution) => contribution.id === 'settings'));

  const host = new PluginHost();
  await assert.rejects(startPluginProductRuntime({ host, data, artifactRoot, collectConsumers: async () => [], includeWebProduct: true }), /require a prepared Pibo 4 cutover/);
  const retained = data.plugins.getInstallation('pibo.product-ui');
  assert.equal(retained.revision, legacy.revision);
  assert.equal(retained.state, 'active');
  assert.equal(retained.enabled, true);
  assert.equal(retained.manifest.contributions.some((contribution) => contribution.id === 'settings'), true);
  assert.equal(host.inspect().state, 'idle');
  assert.equal(data.plugins.getInstallation('pibo.workflows'), undefined);
});

test('disabled managed defaults remain pinned and are not silently re-enabled or upgraded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-default-disabled-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const artifactRoot = join(root, 'artifacts');
  const disabled = await stagedLegacyProductUi(data, artifactRoot, { enabled: false });

  const host = new PluginHost();
  const product = await startPluginProductRuntime({ host, data, artifactRoot, collectConsumers: async () => [] });
  t.after(() => product.dispose());

  const retained = data.plugins.getInstallation('pibo.product-ui');
  assert.equal(retained.revision, disabled.revision);
  assert.equal(retained.state, 'installed');
  assert.equal(retained.enabled, false);
  assert.equal(retained.manifest.contributions.some((contribution) => contribution.id === 'settings'), true);
  assert.equal(host.contributions.get('contribution', 'pibo.product-ui/settings'), undefined);
});

test('AP11 Web Annotations survives failed activation and exact reinstall without losing data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-annotations-reinstall-')); t.after(() => rm(root, { recursive: true, force: true }));
  const previousHome = process.env.PIBO_HOME;
  process.env.PIBO_HOME = root;
  t.after(() => { if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome; });
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const host = new PluginHost();
  const artifactRoot = join(root, 'artifacts');
  const product = await startPluginProductRuntime({ host, data, artifactRoot, collectConsumers: async () => [] });
  t.after(() => product.dispose());

  const annotationStore = new WebAnnotationStore({ path: join(root, 'web-annotations.sqlite') });
  annotationStore.createAnnotation({
    id: 'ann_ap11_retained',
    piboSessionId: 'ps_ap11',
    piboRoomId: 'room_ap11',
    note: 'Retain this annotation through activation recovery and reinstall',
    url: 'http://localhost:3000/apps/chat',
    targetKind: 'element',
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
  });
  annotationStore.close();

  const original = data.plugins.getInstallation('pibo.web-annotations');
  const brokenSource = join(root, 'broken-web-annotations');
  await mkdir(brokenSource);
  await writeFile(join(brokenSource, 'pibo.plugin.json'), JSON.stringify({ ...original.manifest, version: '1.0.1' }));
  await writeFile(join(brokenSource, 'backend.mjs'), `export function setup(context) { context.register('web_annotations_list', { name: 'web_annotations_list', description: 'partial fixture' }); throw new Error('AP11 activation fixture'); }\n`);
  await mkdir(join(brokenSource, 'browser'));
  await writeFile(join(brokenSource, 'browser/index.js'), 'export const WebAnnotationsView = () => null; export const BuildContextView = () => null;\n');
  await product.manager.install({ kind: 'local', path: brokenSource }, { expectedRevision: original.stateRevision });
  const pending = data.plugins.getInstallation('pibo.web-annotations');
  assert.equal(pending.state, 'pending-activation');
  const failed = await product.manager.activate('pibo.web-annotations', { expectedRevision: pending.stateRevision });
  assert.equal(failed.state, 'failed');
  assert.match(failed.diagnostic, /AP11 activation fixture/);
  assert.equal(host.inspect().plugins.some((plugin) => plugin.pluginId === 'pibo.web-annotations'), false);

  const restored = await product.manager.cancelOperation(failed.id);
  assert.equal(restored.state, 'cancelled');
  assert.equal(host.inspect().plugins.find((plugin) => plugin.pluginId === 'pibo.web-annotations')?.revision, original.revision);

  const beforeUninstall = data.plugins.getInstallation('pibo.web-annotations');
  const plan = await product.manager.planUninstall('pibo.web-annotations');
  const removed = await product.manager.confirmUninstall({ planId: plan.id, pluginIdText: 'pibo.web-annotations', expectedRevision: beforeUninstall.stateRevision });
  assert.equal(removed.state, 'complete');
  const tombstone = data.plugins.getInstallation('pibo.web-annotations');
  assert.equal(tombstone.state, 'uninstalled');
  assert.equal(host.inspect().plugins.some((plugin) => plugin.pluginId === 'pibo.web-annotations'), false);

  const source = join(artifactRoot, 'default-sources', 'pibo.web-annotations', original.version);
  await product.manager.install({ kind: 'local', path: source }, { expectedRevision: tombstone.stateRevision });
  const installed = data.plugins.getInstallation('pibo.web-annotations');
  assert.equal(installed.state, 'installed');
  const activated = await product.manager.activate('pibo.web-annotations', { expectedRevision: installed.stateRevision });
  assert.equal(activated.state, 'complete');
  assert.equal(host.inspect().plugins.filter((plugin) => plugin.pluginId === 'pibo.web-annotations').length, 1);

  const reopened = new WebAnnotationStore({ path: join(root, 'web-annotations.sqlite') });
  try {
    assert.equal(reopened.getAnnotation('ps_ap11', 'ann_ap11_retained')?.note, 'Retain this annotation through activation recovery and reinstall');
  } finally {
    reopened.close();
  }
});

test('product runtime added to an existing host removes only its own roots on disposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-incremental-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const host = new PluginHost();
  const manifest = { schemaVersion: 1, id: 'test.system', name: 'Existing system', version: '1.0.0', sdk: '^1.0.0', contributions: [], services: { provides: [{ id: 'test.system.service', version: '1.0.0' }] } };
  await host.start({ plugins: [{ installation: { pluginId: manifest.id, revision: 'builtin:1', contentHash: 'builtin:1', version: manifest.version, manifest, source: { kind: 'builtin', name: manifest.id }, enabled: true, state: 'active', stateRevision: 1, createdAt: new Date().toISOString() }, setup(context) { context.services.provide('test.system.service', { alive: true }); } }] });
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [], readSessionPlan: async () => { throw new Error('unused'); } });
  assert.deepEqual(host.services.get('test.system.service'), { alive: true });
  await product.dispose();
  assert.equal(host.inspect().state, 'active');
  assert.deepEqual(host.services.get('test.system.service'), { alive: true });
  assert.equal(host.services.get(PLUGIN_MANAGEMENT_SERVICE), undefined);
  await host.stop();
});


test('product upgrade replaces an incompatible managed manifest before importing its new packaged backend', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-product-before-import-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') }); t.after(() => data.close());
  const artifactRoot = join(root, 'artifacts');
  const source = join(artifactRoot, 'default-sources', 'pibo.builtin-profiles', '1.0.0');
  await mkdir(source, { recursive: true });
  const current = builtinProfilesPackageManifest();
  await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify({ ...current, contributions: current.contributions.filter(c => c.id !== 'gateway-producer') }));
  await writeFile(join(source, 'backend.mjs'), 'export { setupBuiltinProfiles as setup } from "@pasko70/pibo/plugin-builtin/profiles";\n');
  const manager = new PluginManager({ store: data.plugins, artifactRoot });
  await manager.install({ kind: 'local', path: source }, { expectedRevision: 0 });
  const old = data.plugins.getInstallation(current.id);
  data.plugins.putInstallation({ ...old, enabled: true, state: 'active' }, old.stateRevision);
  const host = new PluginHost();
  const product = await startPluginProductRuntime({ host, data, artifactRoot, collectConsumers: async () => [] });
  t.after(() => product.dispose());
  assert.ok(host.contributions.get('contribution', 'pibo.builtin-profiles/gateway-producer'));
  assert.notEqual(data.plugins.getInstallation(current.id).revision, old.revision);
  assert.equal(data.plugins.getInstallation(current.id).state, 'active');
});
