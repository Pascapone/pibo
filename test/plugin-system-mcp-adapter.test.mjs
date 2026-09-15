import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMinimalAgentRuntimeCapabilities } from '../dist/index.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PluginHost } from '../dist/plugins/host.js';
import { startPluginProductRuntime } from '../dist/plugins/product-runtime.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { mcpAdapterFromPluginPlan, profileFromPluginPlan } from '../dist/agent-runtime/plugin-plan.js';
import { PiboRuntimeResourceService } from '../dist/agent-runtime/resource-service.js';

function materializedMcpCapabilities() {
  const capabilities = createMinimalAgentRuntimeCapabilities();
  capabilities.mcp.externalServers = { support: 'materialized', modes: ['isolated-config'] };
  capabilities.mcp.statusInspection = true;
  return capabilities;
}

test('a second ordinary MCP adapter uses the same delivery contract without touching the internal tool bridge', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') });
  t.after(() => data.close());
  const host = new PluginHost();
  const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => [] });
  t.after(() => product.dispose());

  const source = join(root, 'adapter-source');
  await mkdir(source);
  const manifest = {
    schemaVersion: 1,
    id: 'test.mcp-adapter',
    name: 'Fixture MCP Adapter',
    version: '1.0.0',
    sdk: '^1.0.0',
    entrypoints: { backend: 'backend.mjs' },
    contributions: [{
      id: 'adapter',
      kind: 'mcp-adapter',
      name: 'fixture-mcp',
      scope: 'agent',
      required: false,
      defaultEnabled: true,
      schemaVersion: 1,
      configSchema: { type: 'object', properties: { selectedServers: { type: 'array', items: { type: 'string' } } }, required: ['selectedServers'], additionalProperties: false },
      context: { kind: 'context', stage: 'mcp', description: 'Fixture MCP inventory', loading: 'runtime' },
    }],
  };
  await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'backend.mjs'), `export function setup(context){ context.register('adapter', {
    id: 'fixture-mcp',
    async loadConfig(){ return { mcpServers: { fixture: { command: 'fixture-command', args: [] } } }; },
    isHttpServer(){ return false; },
    scopeServer(_name, config){ return { materialized: config, resolved: config, secretEnvironment: {}, secretEnvironmentKeys: [] }; },
    createAgentContext(selected){ return { path: '.pibo/context/fixture-mcp.md', content: '# Fixture MCP\\n' + selected.join(',') }; }
  }); }`);
  await product.manager.install({ kind: 'local', path: source }, { expectedRevision: 0 });
  let fixture = data.plugins.getInstallation('test.mcp-adapter');
  await product.manager.activate(fixture.pluginId, { expectedRevision: fixture.stateRevision });
  fixture = data.plugins.getInstallation('test.mcp-adapter');

  const pluginSelection = structuredClone(createAgentPluginSelection([fixture]));
  pluginSelection.plugins[0].contributionConfig = { adapter: { selectedServers: ['fixture'] } };
  const declared = new InitialSessionContext({
    profileName: 'fixture',
    mcpServers: ['fixture'],
    pluginSelection,
  });
  const plan = product.runtime.preview(declared, { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, 'ps_fixture');
  assert.equal(plan.valid, true);
  const effective = profileFromPluginPlan(declared, plan, host);
  assert.deepEqual(effective.mcpServers, ['fixture']);
  const adapter = mcpAdapterFromPluginPlan(effective, host);
  assert.equal(adapter.id, 'fixture-mcp');

  const service = new PiboRuntimeResourceService({ rootDir: join(root, 'runtime') });
  const resources = await service.createSession({
    piboSessionId: 'ps_fixture',
    runtimeInstanceId: 'pi',
    adapterId: 'pi',
    sessionGeneration: 'g1',
    profile: effective,
    cwd: root,
    capabilities: materializedMcpCapabilities(),
    strict: false,
    verifyMcp: false,
    mcpAdapter: adapter,
  });
  t.after(() => resources.dispose());
  const inspection = resources.getInspection();
  assert.equal(inspection.mcpServers[0].name, 'fixture');
  assert.equal(inspection.mcpServers[0].status, 'configured');
  assert.ok(resources.getContextContributions().some((entry) => entry.path === '.pibo/context/fixture-mcp.md'));
  assert.equal(resources.getAdapterEnvironment().MCP_CONFIG_PATH.endsWith('mcp-servers.json'), true);
});
