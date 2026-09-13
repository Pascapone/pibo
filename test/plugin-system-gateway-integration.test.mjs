import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiboGatewayServer, migrateSessionRuntimeBindingsAtStartup } from '../dist/gateway/server.js';
import { PiboPluginRegistry } from '../dist/plugins/registry.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
import { PLUGIN_MANAGEMENT_SERVICE } from '../dist/plugins/product-services.js';

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-gateway-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('gateway owns one product host with ordinary default plugin and complete manager lifecycle', async t => {
  const root = await tempRoot(t);
  const registry = PiboPluginRegistry.create();
  t.after(() => registry.disposePlugins());
  const gateway = new PiboGatewayServer({ pluginRegistry: registry, persistSession: false, startChannels: false, host: '127.0.0.1', port: 0, pluginArtifactRoot: join(root, 'artifacts') });
  await gateway.start();
  const host = registry.getPluginHost();
  assert.equal(host.inspect().state, 'active');
  assert.equal(host.inspect().plugins.filter((plugin) => plugin.pluginId === 'pibo.web-annotations').length, 1);
  assert.equal(host.inspect().plugins.filter((plugin) => plugin.pluginId === 'pibo.core').length, 1);
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
  const registry = PiboPluginRegistry.create();
  t.after(() => registry.disposePlugins());
  const gateway = new PiboGatewayServer({ pluginRegistry: registry, persistSession: false, startChannels: false, host: '127.0.0.1', port, pluginArtifactRoot: join(root, 'artifacts') });
  await assert.rejects(gateway.start(), (error) => error?.code === 'EADDRINUSE');
  assert.equal(registry.getPluginHost().inspect().state, 'idle');
  await gateway.stop();
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
