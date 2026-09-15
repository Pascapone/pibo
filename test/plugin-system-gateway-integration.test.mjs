import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createNetServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CustomAgentStore } from '../dist/apps/chat/agent-store.js';
import { PiboGatewayServer, migrateSessionRuntimeBindingsAtStartup } from '../dist/gateway/server.js';
import { PiboCapabilityHost } from '../dist/core/capability-host.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
import { PLUGIN_MANAGEMENT_SERVICE } from '../dist/plugins/product-services.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-gateway-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('gateway owns one product host with ordinary default plugin and complete manager lifecycle', async t => {
  const root = await tempRoot(t);
  const registry = PiboCapabilityHost.create();
  const gateway = new PiboGatewayServer({ capabilityHost: registry, persistSession: false, startChannels: false, host: '127.0.0.1', port: 0, pluginArtifactRoot: join(root, 'artifacts') });
  t.after(() => gateway.stop());
  await gateway.start();
  const host = registry.getPluginHost();
  assert.equal(host.inspect().state, 'active');
  assert.equal(host.inspect().plugins.filter((plugin) => plugin.pluginId === 'pibo.web-annotations').length, 1);
  assert.equal(host.inspect().plugins.some((plugin) => plugin.pluginId === 'pibo.core' || plugin.pluginId === 'pibo.user-resources'), false);
  assert.equal(registry.getCapabilityCatalog().skills.some((skill) => skill.name === 'pi-agent-harness' && skill.pluginId === undefined), true);
  const manager = host.services.get(PLUGIN_MANAGEMENT_SERVICE);
  assert.equal(manager.diagnose().lifecycleAvailable, true);
  assert.equal(manager.diagnose().consumerCollectorAvailable, true);
  await gateway.stop();
  assert.equal(host.inspect().state, 'idle');
});

test('gateway startup failure closes the product host and can be stopped again', async t => {
  const root = await tempRoot(t);
  const blocker = createNetServer();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const port = blocker.address().port;
  const registry = PiboCapabilityHost.create();
    const gateway = new PiboGatewayServer({ capabilityHost: registry, persistSession: false, startChannels: false, host: '127.0.0.1', port, pluginArtifactRoot: join(root, 'artifacts') });
  await assert.rejects(gateway.start(), (error) => error?.code === 'EADDRINUSE');
  assert.equal(registry.getPluginHost().inspect().state, 'idle');
  await gateway.stop();
});

test('gateway automatically detects and imports a sibling legacy session database before opening the Pibo 4 store', async t => {
  const root = await tempRoot(t); const sourcePath = join(root, 'pibo-sessions.sqlite'); const targetPath = join(root, 'pibo.sqlite');
  const source = new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE pibo_sessions(id TEXT PRIMARY KEY,pi_session_id TEXT,channel TEXT,kind TEXT,profile TEXT,parent_id TEXT,origin_id TEXT,workspace TEXT,title TEXT,metadata_json TEXT,created_at TEXT,updated_at TEXT)');
  source.prepare('INSERT INTO pibo_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('ps_gateway_legacy', 'native-gateway', 'web', 'interactive', 'base', null, null, null, 'Gateway legacy', '{}', '2026-01-01', '2026-01-02'); source.close();
  const registry = PiboCapabilityHost.create();
  const gateway = new PiboGatewayServer({ capabilityHost: registry, startChannels: false, host: '127.0.0.1', port: 0, dataStorePath: targetPath, agentStorePath: join(root, 'agents.sqlite'), loopStorePath: join(root, 'loops.sqlite'), pluginArtifactRoot: join(root, 'artifacts') });
  try {
    await gateway.start();
    const data = new PiboDataStore(targetPath); try { assert.equal(data.db.prepare('SELECT title FROM sessions WHERE id=?').get('ps_gateway_legacy').title, 'Gateway legacy'); } finally { data.close(); }
  } finally { await gateway.stop();  }
  const retained = new DatabaseSync(sourcePath, { readOnly: true }); try { assert.equal(retained.prepare('SELECT COUNT(*) AS count FROM pibo_sessions').get().count, 1); } finally { retained.close(); }
});

test('an archived agent with an unavailable runtime does not block gateway startup or healthy profiles', async t => {
  const root = await tempRoot(t);
  const agentStorePath = join(root, 'agents.sqlite');
  const seed = new CustomAgentStore(agentStorePath);
  const archived = seed.create({ displayName: 'archived-removed-runtime', runtimeInstanceId: 'removed-runtime', goalControl: false, runControl: false });
  seed.setArchived(archived.id, true);
  const healthy = seed.create({ displayName: 'healthy-runtime-agent', runtimeInstanceId: 'pi', goalControl: false, runControl: false });
  seed.close();
  const registry = PiboCapabilityHost.create();
  const gateway = new PiboGatewayServer({ capabilityHost: registry, persistSession: false, startChannels: false, host: '127.0.0.1', port: 0, agentStorePath, dataStorePath: join(root, 'pibo.sqlite'), pluginArtifactRoot: join(root, 'artifacts') });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await gateway.start();
    assert.equal(registry.getProfileNames().includes(healthy.profileName), true);
    assert.equal(registry.getProfileNames().includes(archived.profileName), false);
    const stored = new CustomAgentStore(agentStorePath);
    try {
      const blocked = stored.get(archived.id);
      assert.equal(blocked.pluginMigration.status, 'conflict');
      assert.equal(blocked.pluginMigration.diagnostics[0].code, 'stored-runtime-unavailable');
      assert.equal(stored.get(healthy.id).pluginMigration.status, 'ready');
    } finally { stored.close(); }
    assert.equal(errors.some((message) => message.includes(archived.profileName) && message.includes('removed-runtime')), true);
  } finally {
    console.error = originalError;
    await gateway.stop();

  }
});

test('Pibo 4.0 startup persists runtime bindings exactly once without changing session identity or history', () => {
  const store = new InMemoryPiboSessionStore();
  const session = store.create({ id: 'ps_v4_binding', channel: 'pibo.chat-web', kind: 'chat', profile: 'base', piSessionId: 'native-history-id' });
  assert.equal(session.runtimeBinding.revision, 1);
  assert.equal(migrateSessionRuntimeBindingsAtStartup(store), 1);
  const migrated = store.get('ps_v4_binding');
  assert.equal(migrated.piSessionId, 'native-history-id');
  assert.equal(migrated.runtimeBinding.nativeSessionId, 'native-history-id');
  assert.equal(migrated.runtimeBinding.metadata.pibo4RuntimeBindingMigrated, true);
  assert.equal(migrated.runtimeBinding.revision, 2);
  assert.equal(migrateSessionRuntimeBindingsAtStartup(store), 0);
  assert.equal(store.get('ps_v4_binding').runtimeBinding.revision, 2);
});
