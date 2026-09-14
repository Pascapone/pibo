import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PluginHost } from '../dist/plugins/host.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { startPluginProductRuntime } from '../dist/plugins/product-runtime.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { PiboPortableToolService } from '../dist/tools/session-service.js';
import { PIBO_SESSION_CONTEXT_SERVICE } from '../dist/plugins/runtime.js';

const execFileAsync = promisify(execFile);

function installation(manifest, revision = 'sha256:fixture') {
  return {
    pluginId: manifest.id,
    revision,
    contentHash: revision,
    version: manifest.version,
    manifest,
    source: { kind: 'local', path: '/tmp/fixture' },
    enabled: true,
    state: 'active',
    stateRevision: 1,
    createdAt: new Date().toISOString(),
  };
}

test('core services validate plugin dependencies without becoming plugin installations', async () => {
  const host = new PluginHost();
  const disposeService = host.provideCoreService({ id: 'example.core.marker', version: '1.2.0', value: { marker: true } });
  await host.start({ plugins: [] });
  assert.deepEqual(host.inspect().plugins, []);
  assert.equal(host.services.owners()['example.core.marker'], '@pibo/core');

  const incompatibleManifest = {
    schemaVersion: 1,
    id: 'example.incompatible-consumer',
    name: 'Incompatible external consumer',
    version: '1.0.0',
    sdk: '^1.0.0',
    services: { requires: [{ id: 'example.core.marker', version: '^2.0.0' }] },
    contributions: [],
  };
  await assert.rejects(host.add({ plugins: [{ installation: installation(incompatibleManifest), setup() { throw new Error('must not run'); } }] }), /does not satisfy/);
  assert.deepEqual(host.inspect().plugins, []);

  const manifest = {
    schemaVersion: 1,
    id: 'example.consumer',
    name: 'External consumer',
    version: '1.0.0',
    sdk: '^1.0.0',
    services: { requires: [{ id: 'example.core.marker', version: '^1.0.0' }] },
    contributions: [],
  };
  let observed;
  await host.add({ plugins: [{ installation: installation(manifest), setup(context) { observed = context.services.require('example.core.marker'); } }] });
  assert.deepEqual(observed, { marker: true });
  assert.deepEqual(host.inspect().plugins.map((plugin) => plugin.pluginId), ['example.consumer']);
  await assert.rejects(disposeService(), /cannot drain while example\.consumer is active/);

  await host.stop();
  await disposeService();
  assert.equal(host.services.get('example.core.marker'), undefined);
});

test('session tool providers are generation-pinned, service-aware, conflict-checked, and cleaned up', async () => {
  const service = new PiboPortableToolService();
  let disposed = 0;
  let providerContext;
  const session = service.createSession({
    piboSessionId: 'ps_provider',
    piboRoomId: 'room_provider',
    runtimeInstanceId: 'runtime-free-name',
    adapterId: 'adapter-free-name',
    sessionGeneration: 'generation-provider-1',
    profile: new InitialSessionContext({ profileName: 'external-profile' }),
    cwd: '/tmp',
    sessionServices: { [PIBO_SESSION_CONTEXT_SERVICE]: { marker: 'core-context' } },
    sessionToolProviders: [{
      pluginId: 'org.example.aurora',
      pluginRevision: 'sha256:aurora',
      providerContributionId: 'org.example.aurora/provider',
      configuration: { tone: 'calm' },
      contributionConfiguration: {},
      selectedTools: [{ contributionId: 'org.example.aurora/echo', name: 'aurora_echo', configuration: { tone: 'calm' }, contributionConfiguration: { prefix: 'aurora' } }],
      provider: {
        createSession(context) {
          providerContext = context;
          assert.deepEqual(context.services.require(PIBO_SESSION_CONTEXT_SERVICE), { marker: 'core-context' });
          assert.deepEqual(context.selectedTools.map((entry) => entry.contributionId), ['org.example.aurora/echo']);
          return {
            tools: [{ contributionId: 'org.example.aurora/echo', definition: {
              name: 'aurora_echo', title: 'Aurora Echo', description: 'Echoes arbitrary input.',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
              async execute(_callId, input, _signal, _onUpdate, execution) {
                return { content: [{ type: 'text', text: `${execution.plugin.contributionConfiguration.prefix}:${input.text}` }] };
              },
            } }],
            async dispose() { await Promise.resolve(); disposed += 1; },
          };
        },
      },
    }],
  });

  const tool = session.createDefinitions().find((definition) => definition.name === 'aurora_echo');
  assert.ok(tool);
  assert.equal(providerContext.sessionGeneration, 'generation-provider-1');
  assert.equal(providerContext.plugin.contributionId, 'org.example.aurora/provider');
  const result = await tool.execute('call-1', { text: 'hello' }, undefined, undefined, { cwd: '/tmp', sessionGeneration: 'generation-provider-1' });
  assert.equal(result.content[0].text, 'aurora:hello');

  await session.dispose();
  assert.equal(disposed, 1);
  assert.throws(() => tool.execute('call-stale', { text: 'late' }, undefined, undefined, { cwd: '/tmp', sessionGeneration: 'generation-provider-1' }), /no longer active/);
  await service.dispose();
});

test('session tool providers cannot expose unselected tools and async cleanup failures remain visible', async () => {
  const service = new PiboPortableToolService();
  let rolledBack = 0;
  const provider = (providerContributionId, registrations, dispose) => ({
    pluginId: 'org.example.strict', pluginRevision: 'sha256:strict', providerContributionId,
    configuration: {}, contributionConfiguration: {},
    selectedTools: [{ contributionId: `${providerContributionId}-tool`, name: `${providerContributionId.split('/').at(-1)}_tool`, configuration: {}, contributionConfiguration: {} }],
    provider: { createSession() { return { tools: registrations, dispose }; } },
  });
  const validDefinition = (name) => ({
    name, title: name, description: name,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: 'text', text: 'ok' }] }; },
  });
  const bypass = service.createSession({
    piboSessionId: 'ps_bypass', runtimeInstanceId: 'runtime', adapterId: 'adapter', sessionGeneration: 'generation-bypass',
    profile: new InitialSessionContext({ profileName: 'strict' }), cwd: '/tmp',
    sessionToolProviders: [
      provider('org.example.strict/first', [{ contributionId: 'org.example.strict/first-tool', definition: validDefinition('first_tool') }], async () => { await Promise.resolve(); rolledBack += 1; }),
      provider('org.example.strict/second', [
        { contributionId: 'org.example.strict/second-tool', definition: validDefinition('second_tool') },
        { contributionId: 'org.example.strict/hidden-tool', definition: validDefinition('hidden_tool') },
      ], async () => { await Promise.resolve(); rolledBack += 1; }),
    ],
  });
  assert.throws(() => bypass.createDefinitions(), /undeclared or unselected tool org\.example\.strict\/hidden-tool/);
  await bypass.dispose();
  assert.equal(rolledBack, 2, 'all partially created provider sets are drained');

  const cleanupFailure = service.createSession({
    piboSessionId: 'ps_cleanup', runtimeInstanceId: 'runtime', adapterId: 'adapter', sessionGeneration: 'generation-cleanup',
    profile: new InitialSessionContext({ profileName: 'strict' }), cwd: '/tmp',
    sessionToolProviders: [provider('org.example.strict/failing', [{ contributionId: 'org.example.strict/failing-tool', definition: validDefinition('failing_tool') }], async () => { await Promise.resolve(); throw new Error('async cleanup failed'); })],
  });
  cleanupFailure.createDefinitions();
  await assert.rejects(cleanupFailure.dispose(), /Session tool provider cleanup failed/);
  await service.dispose();
});

test('an out-of-repository package compiles and runs using only public plugin subpaths', async t => {
  const projectRoot = process.cwd();
  const root = await mkdtemp(join(tmpdir(), 'pibo-external-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'src');
  const artifactRoot = join(root, 'artifact');
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(join(root, 'node_modules', '@pasko70'), { recursive: true });
  await symlink(projectRoot, join(root, 'node_modules', '@pasko70', 'pibo'), 'dir');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/aurora-plugin', private: true, type: 'module' }, null, 2));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, outDir: './artifact', rootDir: './src', skipLibCheck: true },
    include: ['./src/**/*.ts'],
  }, null, 2));
  await writeFile(join(sourceRoot, 'backend.ts'), `
import type { PluginSetupContext } from '@pasko70/pibo/plugin-host';
import type { PluginManifest } from '@pasko70/pibo/plugin-sdk';
import { definePiboTool, definePluginSessionToolProvider, PIBO_SESSION_CONTEXT_SERVICE, type PiboToolInputSchema } from '@pasko70/pibo/plugin-runtime';

export const manifest = {
  schemaVersion: 1,
  id: 'org.example.aurora',
  name: 'Aurora external fixture',
  version: '1.0.0',
  sdk: '^1.0.0',
  entrypoints: { backend: 'backend.js', browser: 'browser.js' },
  services: { requires: [{ id: 'example.core.marker', version: '^1.0.0' }] },
  config: { schemaVersion: 1, scopes: ['app', 'agent', 'session'], schema: { type: 'object', properties: { tone: { type: 'string' } }, additionalProperties: false } },
  contributions: [
    { id: 'provider', kind: 'session-tool-provider', title: 'Aurora tool provider', scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Session generation infrastructure' } },
    { id: 'echo', kind: 'tool', name: 'aurora_echo', title: 'Aurora Echo', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, dependsOn: ['org.example.aurora/provider'], sessionToolProvider: 'org.example.aurora/provider', runtime: { adapterIds: ['custom-adapter'] }, context: { kind: 'none', reason: 'Created for the selected session generation' } },
    { id: 'context', kind: 'context-file', title: 'Aurora context', scope: 'agent', required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: 'context', stage: 'context', description: 'Aurora context', loading: 'eager' } },
    { id: 'settings', kind: 'settings', title: 'Aurora settings', scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Application settings' } },
    { id: 'view', kind: 'view', title: 'Aurora view', scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Application view' }, view: { title: 'Aurora', exportName: 'AuroraView', presentation: 'workspace', instance: 'singleton', mount: 'keep-alive', stateSchemaVersion: 1 } },
  ],
} satisfies PluginManifest;

export function setup(context: PluginSetupContext) {
  const marker = context.services.require<{ label: string }>('example.core.marker');
  context.register('provider', definePluginSessionToolProvider({
    createSession(session) {
      const coreContext = session.services.require<{ piboSessionId: string }>(PIBO_SESSION_CONTEXT_SERVICE);
      return { tools: session.selectedTools.map((selected) => ({ contributionId: selected.contributionId, definition: definePiboTool({
        name: selected.name, title: 'Aurora Echo', description: marker.label,
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } as PiboToolInputSchema,
        async execute(_callId, input) { return { content: [{ type: 'text', text: coreContext.piboSessionId + ':' + String((input as { text: string }).text) }] }; },
      }) })) };
    },
  }));
  context.register('context', { key: 'aurora-context', path: '/virtual/aurora.md', content: 'Aurora context' });
  context.register('settings', { section: 'aurora', label: marker.label });
  context.register('view', { exportName: 'AuroraView' });
}
`);
  await writeFile(join(sourceRoot, 'browser.ts'), `
import type { PluginBrowserSetup, PluginViewProps } from '@pasko70/pibo/plugin-sdk';
export function AuroraView(_props: PluginViewProps) { return null; }
export function setup(_host: PluginBrowserSetup) { return undefined; }
`);

  await execFileAsync(process.execPath, [join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.json')], { cwd: root });
  const backendSource = await readFile(join(artifactRoot, 'backend.js'), 'utf8');
  assert.match(backendSource, /@pasko70\/pibo\/plugin-runtime/);
  assert.doesNotMatch(backendSource, /plugin-builtin|\/src\//);
  const module = await import(pathToFileURL(join(artifactRoot, 'backend.js')).href);
  await writeFile(join(artifactRoot, 'pibo.plugin.json'), JSON.stringify(module.manifest, null, 2));

  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') });
  t.after(() => data.close());
  const host = new PluginHost();
  const disposeMarker = host.provideCoreService({ id: 'example.core.marker', version: '1.0.0', value: { label: 'External marker' } });
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'installed'), collectConsumers: async () => [], installDefaultPlugins: false });
  assert.deepEqual(host.inspect().plugins, [], 'minimal product bootstrap has core services and zero plugin installations');
  t.after(async () => { await product.dispose(); await disposeMarker(); });

  await product.manager.install({ kind: 'local', path: artifactRoot }, { expectedRevision: 0 });
  let installed = data.plugins.getInstallation('org.example.aurora');
  await product.manager.activate(installed.pluginId, { expectedRevision: installed.stateRevision });
  installed = data.plugins.getInstallation(installed.pluginId);
  assert.equal(host.contributions.get('contribution', 'org.example.aurora/context').value.key, 'aurora-context');
  assert.equal(host.contributions.get('contribution', 'org.example.aurora/settings').value.section, 'aurora');
  assert.equal(host.contributions.get('contribution', 'org.example.aurora/view').value.exportName, 'AuroraView');

  const profile = new InitialSessionContext({ profileName: 'aurora-profile', pluginSelection: createAgentPluginSelection([installed]) });
  const generation = product.runtime.reserve(profile, { adapterId: 'custom-adapter', instanceId: 'custom-runtime', capabilities: {} }, 'ps_external', 'generation-external-1');
  const tools = new PiboPortableToolService();
  const toolSession = tools.createSession({
    piboSessionId: 'ps_external', runtimeInstanceId: 'custom-runtime', adapterId: 'custom-adapter', sessionGeneration: 'generation-external-1',
    profile: generation.profile, cwd: '/tmp', sessionToolProviders: generation.sessionToolProviders,
    sessionServices: { [PIBO_SESSION_CONTEXT_SERVICE]: { piboSessionId: 'ps_external' } },
  });
  const externalTool = toolSession.createDefinitions().find((tool) => tool.name === 'aurora_echo');
  assert.ok(externalTool);
  const result = await externalTool.execute('call-external', { text: 'hello' }, undefined, undefined, { cwd: '/tmp', sessionGeneration: 'generation-external-1' });
  assert.equal(result.content[0].text, 'ps_external:hello');
  await toolSession.dispose();
  await tools.dispose();
  product.runtime.release(generation);

  const disabledSelection = structuredClone(profile.pluginSelection);
  disabledSelection.plugins[0].contributions.echo = false;
  const disabledProfile = new InitialSessionContext({ profileName: 'aurora-disabled', pluginSelection: disabledSelection });
  const disabledPlan = product.runtime.preview(disabledProfile, { adapterId: 'custom-adapter', instanceId: 'custom-runtime', capabilities: {} }, 'ps_external_disabled');
  assert.equal(disabledPlan.contributions.some((entry) => entry.id === 'org.example.aurora/echo'), false);

  const incompatiblePlan = product.runtime.preview(profile, { adapterId: 'other-adapter', instanceId: 'other-runtime', capabilities: {} }, 'ps_external_incompatible');
  assert.equal(incompatiblePlan.contributions.some((entry) => entry.id === 'org.example.aurora/echo'), false);
  assert.ok(incompatiblePlan.diagnostics.some((entry) => entry.code === 'runtime-unsupported'));

  const browser = await import(pathToFileURL(join(artifactRoot, 'browser.js')).href);
  assert.equal(typeof browser.AuroraView, 'function');
  assert.equal(typeof browser.setup, 'function');
});
