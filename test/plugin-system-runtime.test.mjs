import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from 'typebox';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginHost } from '../dist/plugins/host.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { PluginRuntimeCoordinator, resolveRuntimePluginPlan, profileFromPluginPlan } from '../dist/agent-runtime/plugin-plan.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { PiboPortableToolService } from '../dist/tools/session-service.js';
import { AgentRuntimeAdapterRegistry } from '../dist/agent-runtime/registry.js';
import { createFakeAgentRuntimeDriver } from '../dist/agent-runtime/testing/fake-adapter.js';
import { pluginOnlyPiServicesOptions, pluginOnlyPiSettings } from '../dist/agent-runtimes/pi/plugin-discovery.js';
import { createAgentSessionServices, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fixture } from './plugin-system-management-helpers.mjs';
import { PiboPluginRegistry, definePiboPlugin } from '../dist/plugins/registry.js';
import { PiboSessionRouter } from '../dist/core/session-router.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
import { createMinimalAgentRuntimeCapabilities } from '../dist/agent-runtime/capabilities.js';

const context = { kind: 'context', stage: 'tools', description: 'Tool schema', loading: 'runtime' };
const contribution = (id, extra = {}) => ({ id, kind: 'tool', name: id, scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context, ...extra });
const install = (contributions) => ({ pluginId: 'test.runtime', revision: 'r1', version: '1.0.0', contentHash: 'sha256:abc', source: { kind: 'builtin', name: 'test.runtime' }, enabled: true, state: 'active', stateRevision: 1, createdAt: '2026-09-12T00:00:00Z', manifest: { schemaVersion: 1, id: 'test.runtime', name: 'Runtime fixture', version: '1.0.0', sdk: '^1.0.0', contributions } });
const definition = name => ({ name, title: name, description: name, inputSchema: Type.Object({}), async execute() { return { content: [{ type: 'text', text: name }] }; } });

for (const adapterId of ['pi', 'codex-native', 'omp']) test(`${adapterId}: effective selection controls real portable tool definitions, config and excluded Pi factory`, async () => {
  let privateCalls = 0, portableCalls = 0, seenConfig;
  const installation = install([contribution('portable'), contribution('pi_private', { runtime: { adapterIds: ['pi'] } }), contribution('disabled')]);
  const host = new PluginHost();
  await host.start({ plugins: [{ installation, setup(ctx) {
    ctx.register('portable', { name: 'portable', createDefinition(context) { portableCalls++; seenConfig = context.plugin; return definition('portable'); } });
    ctx.register('pi_private', { name: 'pi_private', createDefinition() { privateCalls++; return definition('pi_private'); } });
    ctx.register('disabled', { name: 'disabled', createDefinition() { throw new Error('unselected factory executed'); } });
  } }] });
  const selection = structuredClone(createAgentPluginSelection([installation])); selection.plugins[0].contributions.disabled = false; selection.plugins[0].config = { suffix: 'pinned' };
  const profile = new InitialSessionContext({ profileName: 'agent', pluginSelection: selection, pluginSelectionRevision: 4, skills: [{ name: 'user', path: '/user/SKILL.md', kind: 'user' }], contextFiles: [{ key: 'user', path: '/user/AGENTS.md', source: 'managed' }], tools: [{ name: 'legacy-write', definition: definition('legacy-write') }], mcpServers: ['legacy-server'] });
  const plan = resolveRuntimePluginPlan({ profile, runtime: { adapterId, instanceId: adapterId, capabilities: {} }, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, kind: 'generation', piboSessionId: 'ps_a', generation: 'g1' });
  assert.equal(plan.valid, true); assert.equal(privateCalls + portableCalls, 0);
  const effective = profileFromPluginPlan(profile, plan, host);
  selection.plugins[0].config.suffix = 'later';
  const service = new PiboPortableToolService();
  try {
    const session = service.createSession({ profile: effective, piboSessionId: 'ps_a', runtimeInstanceId: adapterId, adapterId, sessionGeneration: 'g1', cwd: '/tmp' });
    const tools = session.createDefinitions();
    assert.deepEqual(tools.map(t => t.name), adapterId === 'pi' ? ['legacy-write', 'pi_private', 'portable'] : ['legacy-write', 'portable']);
    assert.equal(privateCalls, adapterId === 'pi' ? 1 : 0); assert.equal(portableCalls, 1);
    assert.equal(seenConfig.configuration.suffix, 'pinned'); assert.equal(seenConfig.contributionId, 'test.runtime/portable');
    assert.deepEqual(effective.mcpServers, []); assert.equal('piPackages' in effective, false);
    assert.equal(effective.skills[0].kind, 'user'); assert.equal(plan.resources.length, 2);
    assert.deepEqual(session.getDefinitions().map(t => t.name), tools.map(t => t.name));
    session.createDefinitions(); assert.equal(portableCalls, 1);
    const result = await tools.find(t => t.name === 'portable').execute('call', {}, undefined, undefined, { cwd: '/tmp' }); assert.equal(result.content[0].text, 'portable');
    if (adapterId !== 'pi') assert.equal(plan.nodes.find(n => n.id === 'test.runtime/pi_private').status, 'unsupported');
  } finally { await service.dispose(); await host.stop(); }
});

test('required Pi-only contribution rejects before reading host implementation', () => {
  const installation = install([contribution('private', { required: true, runtime: { adapterIds: ['pi'] } })]);
  for (const adapterId of ['codex-native', 'omp']) {
    const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]) });
    const plan = resolveRuntimePluginPlan({ profile, runtime: { adapterId, instanceId: adapterId, capabilities: {} }, catalog: { schemaVersion: 1, revision: 1, installations: [installation] } });
    assert.equal(plan.valid, false);
    assert.throws(() => profileFromPluginPlan(profile, plan, { get contributions() { throw new Error('implementation touched'); } }), /[Pp]lugin/);
  }
});

test('coordinator reserves pinned generation, survives retirement until explicit disposal release and freezes selection', async t => {
  const f = await fixture(t); const installation = await f.active(); const host = new PluginHost();
  await host.start({ plugins: [{ installation, setup(ctx) { ctx.register('read', { name: 'notes_read', definition: definition('notes_read') }); } }] }); t.after(() => host.stop());
  const coordinator = new PluginRuntimeCoordinator({ store: f.store, manager: f.manager, host });
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]), pluginSelectionRevision: 2 });
  const generation = coordinator.reserve(profile, { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, 'ps_a', 'g1');
  assert.equal(f.store.getAdmission('ps_a', 'g1').state, 'reserved');
  assert.equal(f.store.getGenerationSnapshot('ps_a', 'g1').plan.generation, 'g1');
  profile.pluginSelection.plugins[0].enabled = false;
  assert.equal(generation.plan.selection.plugins[0].enabled, true);
  const op = await f.manager.planUninstall('test.notes');
  await f.manager.confirmUninstall({ planId: op.id, pluginIdText: 'test.notes', expectedRevision: op.installationRevision });
  assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
  const original = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]) });
  assert.throws(() => coordinator.reserve(original, { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, 'ps_b', 'g2'));
  assert.equal(f.store.getAdmission('ps_a', 'g1').state, 'reserved');
  coordinator.release(generation); assert.equal(f.store.getAdmission('ps_a', 'g1').state, 'released');
  assert.equal(f.store.getGenerationSnapshot('ps_a', 'g1').plan.selection.plugins[0].enabled, true);
});

test('registration removal rejects referenced drivers and never aborts live runtime sessions', async () => {
  const registry = new AgentRuntimeAdapterRegistry(); registry.registerDriver(createFakeAgentRuntimeDriver()); const adapter = registry.registerInstance({ id: 'fake', adapterId: 'fake' });
  assert.throws(() => registry.unregisterDriver('fake'), /referenced/);
  let disposals = 0; adapter.disposeAuth = async () => { disposals++; };
  assert.equal(registry.unregisterInstance('fake'), true); assert.equal(disposals, 0);
  assert.equal(registry.unregisterInstance('fake'), false); assert.equal(registry.unregisterDriver('fake'), true);
});

test('Pi discovery policy blocks implicit packages/extensions without mutating user settings and preserves explicit factories/context/skills', async t => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-runtime-discovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent'), project = join(root, '.pi'), ext = join(project, 'extensions');
  await mkdir(ext, { recursive: true }); await mkdir(agentDir);
  const marker = join(root, 'implicit-ran');
  await writeFile(join(ext, 'bad.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'bad'); export default () => {};`);
  const settings = { packages: ['./nonexistent-package'], extensions: [join(ext, 'bad.mjs')] };
  await writeFile(join(project, 'settings.json'), JSON.stringify(settings));
  await writeFile(join(root, 'AGENTS.md'), 'independent context');
  const skill = join(root, 'SKILL.md'); await writeFile(skill, '---\nname: independent\ndescription: independent user skill\n---\nbody');
  const original = SettingsManager.create(root, agentDir); const filtered = pluginOnlyPiSettings(original);
  assert.deepEqual(filtered.getProjectSettings().packages, []); assert.deepEqual(original.getProjectSettings().packages, settings.packages);
  let explicit = 0;
  const services = await createAgentSessionServices(pluginOnlyPiServicesOptions({ cwd: root, agentDir, settingsManager: original, resourceLoaderOptions: { noSkills: true, additionalSkillPaths: [skill], extensionFactories: [() => { explicit++; }] } }));
  assert.equal(explicit, 1); await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.ok(services.resourceLoader.getAgentsFiles().agentsFiles.some(f => f.content.includes('independent context')));
  assert.ok(services.resourceLoader.getSkills().skills.some(s => s.name === 'independent'));
  assert.deepEqual(JSON.parse(await readFile(join(project, 'settings.json'), 'utf8')), settings);
});


test('real router reserves before async adapter setup, pins active config, captures build and releases only after disposal', async t => {
  const f = await fixture(t); const installation = await f.active(); const host = new PluginHost();
  await host.start({ plugins: [{ installation, setup(ctx) { ctx.register('read', { name: 'notes_read', definition: definition('notes_read') }); } }] });
  const coordinator = new PluginRuntimeCoordinator({ store: f.store, manager: f.manager, host });
  const selection = structuredClone(createAgentPluginSelection([installation]));
  const capabilities = createMinimalAgentRuntimeCapabilities(); capabilities.tools.piboManaged = { support: 'direct' }; capabilities.context = { support: 'direct' };
  const driver = createFakeAgentRuntimeDriver({ adapterId: 'runtime-test', capabilities });
  let profileSelectionRevision = 1;
  const registry = PiboPluginRegistry.create({ host, plugins: [definePiboPlugin({ id: 'test.runtime-provider', register(api) {
    api.registerAgentRuntimeDriver(driver); api.registerAgentRuntimeInstance({ id: 'runtime-test', adapterId: 'runtime-test' });
    api.registerProfile({ name: 'runtime-test-profile', create() { return new InitialSessionContext({ profileName: 'runtime-test-profile', runtimeInstanceId: 'runtime-test', pluginSelection: selection, pluginSelectionRevision: profileSelectionRevision, builtinTools: 'disabled', autoContextFiles: false, toolPackages: { goalControl: false } }); } });
  } })] });
  const adapter = registry.requireAgentRuntimeAdapter('runtime-test'); const originalOpen = adapter.openSession.bind(adapter);
  let pinned, disposed = false;
  adapter.openSession = async input => {
    pinned = input.services.portableTools.sessionGeneration;
    assert.equal(f.store.getAdmission(input.piboSession.id, pinned).state, 'reserved');
    assert.deepEqual(input.services.portableTools.createDefinitions().map(t => t.name), ['notes_read']);
    const session = await originalOpen(input); const dispose = session.dispose.bind(session);
    session.dispose = async () => { assert.equal(f.store.getAdmission('ps_router_plugin', pinned).state, 'reserved'); await dispose(); disposed = true; };
    return session;
  };
  const store = new InMemoryPiboSessionStore(); store.create({ id: 'ps_router_plugin', profile: 'runtime-test-profile', channel: 'test', kind: 'chat', workspace: f.root, runtimeBinding: { runtimeInstanceId: 'runtime-test', adapterId: 'runtime-test', state: 'unbound' } });
  const historicalProfile = new InitialSessionContext({ profileName: 'runtime-test-profile', runtimeInstanceId: 'runtime-test', pluginSelection: structuredClone(selection), pluginSelectionRevision: 1, builtinTools: 'disabled', autoContextFiles: false, toolPackages: { goalControl: false } });
  const historicalPlan = resolveRuntimePluginPlan({ profile: historicalProfile, runtime: { adapterId: 'runtime-test', instanceId: 'runtime-test', capabilities }, catalog: { schemaVersion: 1, revision: 1, installations: [installation] }, kind: 'generation', piboSessionId: 'ps_router_plugin', generation: 'g_historical' });
  f.store.putGenerationSnapshot({ piboSessionId: 'ps_router_plugin', generationId: 'g_historical', plan: historicalPlan, createdAt: '2026-09-12T00:00:00Z' });
  profileSelectionRevision = 2;
  const router = new PiboSessionRouter({ pluginRegistry: registry, pluginRuntime: coordinator, sessionStore: store, persistSession: false });
  try {
    const idleCurrent = await router.readPluginSessionPlan('ps_router_plugin', 'current');
    const historicalActual = await router.readPluginSessionPlan('ps_router_plugin', 'actual');
    assert.equal(idleCurrent.plan.kind, 'preview'); assert.equal(idleCurrent.plan.generation, undefined); assert.equal(idleCurrent.plan.selectionRevision, 2);
    assert.equal(historicalActual.plan.kind, 'generation'); assert.equal(historicalActual.plan.generation, 'g_historical'); assert.equal(historicalActual.plan.selectionRevision, 1);
    await router.getSessionStatusSnapshot('ps_router_plugin');
    assert.ok(pinned); assert.equal(adapter.openInputs[0].profile.effectivePluginPlan.generation, pinned);
    const liveCurrent = await router.readPluginSessionPlan('ps_router_plugin', 'current');
    assert.equal(liveCurrent.plan.kind, 'generation'); assert.equal(liveCurrent.plan.generation, pinned); assert.equal(liveCurrent.plan.selectionRevision, 2);
    selection.plugins[0].enabled = false;
    await router.getSessionStatusSnapshot('ps_router_plugin');
    assert.equal(adapter.openInputs.length, 1); assert.equal(adapter.openInputs[0].profile.effectivePluginPlan.selection.plugins[0].enabled, true);
    assert.ok(f.store.listBuildSnapshots('ps_router_plugin').some(s => s.snapshotId.startsWith('build-')));
  } finally { await router.disposeAll(); await host.stop(); }
  assert.equal(disposed, true); assert.equal(f.store.getAdmission('ps_router_plugin', pinned).state, 'released');
});

test('system tool registrations are not delivered to the model without agent scope', async t => {
  const installation = install([contribution('system_command', { scope: 'app' }), contribution('agent_command')]);
  const host = new PluginHost();
  await host.start({ plugins: [{ installation, setup(ctx) {
    ctx.register('system_command', { name: 'system_command', createDefinition() { throw new Error('App factory must not enter runtime'); } });
    ctx.register('agent_command', { name: 'agent_command', definition: definition('agent_command') });
  } }] });
  t.after(() => host.stop());
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]) });
  const plan = resolveRuntimePluginPlan({ profile, runtime: { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, catalog: { schemaVersion: 1, revision: 1, installations: [installation] } });
  assert.equal(plan.valid, true);
  assert.deepEqual(profileFromPluginPlan(profile, plan, host).tools.map(t => t.name), ['agent_command']);
});
