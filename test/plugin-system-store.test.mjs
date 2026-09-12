import test from 'node:test';
import assert from 'node:assert/strict';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { fixture, tabset, snapshot } from './plugin-system-management-helpers.mjs';

test('installation state CAS persists across independent connections and tombstones', async (t) => {
  const f = await fixture(t); await f.install(); const old = f.store.getInstallation('test.notes');
  const second = new PiboDataStore(f.data.path, { payloadRootDir: f.root + '/payloads' }); t.after(() => second.close());
  const updated = f.store.putInstallation({ ...old, state: 'uninstalled', enabled: false }, old.stateRevision);
  assert.equal(updated.stateRevision, old.stateRevision + 1);
  assert.throws(() => second.plugins.putInstallation({ ...old, state: 'active' }, old.stateRevision), /changed/);
  await f.install(); assert.equal(f.store.getInstallation('test.notes').stateRevision, updated.stateRevision + 1);
  assert.ok(f.store.getArtifact('test.notes', old.contentHash));
});
test('session tabsets use CAS and fixed session identity, never global or agent identity', async (t) => {
  const f = await fixture(t); const a = f.store.putTabset(tabset('ps_a'), 0); f.store.putTabset(tabset('ps_b', 'B'), 0);
  assert.throws(() => f.store.putTabset(tabset('ps_a', 'stale'), 0), /changed/);
  assert.throws(() => f.store.putTabset({ ...a, piboSessionId: 'ps_b' }, 1), /unbound/);
  assert.throws(() => f.store.putTabset({ ...a, activeTabId: 'absent' }, 1), /absent/);
  assert.throws(() => f.store.putTabset(tabset('room_a'), 0), /Pibo Session/);
  assert.equal(f.store.getTabset('ps_b').tabs[0].state.value, 'B');
  assert.equal(f.store.getTabset('ps_a').tabs[0].state.value, 'A');
});
test('configuration scopes, CAS and credential references are independently persisted', async (t) => {
  const f = await fixture(t);
  for (const target of [{ scope: 'app', pluginId: 'test.notes' }, { scope: 'agent', pluginId: 'test.notes', agentId: 'agent-a' }, { scope: 'session', pluginId: 'test.notes', piboSessionId: 'ps_a' }]) {
    const config = { target, schemaVersion: 1, revision: 0, values: { credential: { secretRef: 'vault:notes' }, value: target.scope } };
    f.store.putConfig(config, 0); assert.equal(f.store.getConfig(target).values.value, target.scope);
    assert.throws(() => f.store.putConfig(config, 0), /changed/);
    assert.throws(() => f.store.putConfig({ ...config, values: { apiKey: 'do-not-persist' } }, 1), /secretRef/);
  }
});
test('generation and build snapshots are immutable and lists do not hydrate payloads', async (t) => {
  const f = await fixture(t); await f.install(); const record = snapshot(f.store.getInstallation('test.notes'));
  f.store.putGenerationSnapshot(record); f.store.putGenerationSnapshot(record);
  assert.throws(() => f.store.putGenerationSnapshot({ ...record, plan: { ...record.plan, selectionRevision: 2 } }), /immutable/);
  const payload = f.data.payloads.writePayload({ value: 'retained context', retentionClass: 'plugin_snapshot' });
  const build = { piboSessionId: 'ps_a', generationId: 'g1', snapshotId: 'b1', kind: 'actual', createdAt: record.createdAt, data: { payloadRef: payload.id, nodes: [] } };
  f.store.putBuildSnapshot(build); f.store.putBuildSnapshot(build);
  assert.throws(() => f.store.putBuildSnapshot({ ...build, snapshotId: 'secret', data: { text: 'Bearer do-not-persist' } }), /redacted/);
  assert.throws(() => f.store.putGenerationSnapshot({ ...record, generationId: 'wrong-generation' }), /matching session\/generation/);
  assert.throws(() => f.store.putBuildSnapshot({ ...build, data: { replacement: true } }), /immutable/);
  assert.throws(() => f.store.putBuildSnapshot({ ...build, piboSessionId: 'ps_b' }), /persisted generation/);
  assert.equal('data' in f.store.listBuildSnapshots('ps_a')[0], false);
  assert.equal(f.store.getBuildSnapshot('ps_a', 'b1').data.payloadRef, payload.id);
  assert.equal(f.data.payloads.getPayload(payload.id).refCount, 2);
  f.data.payloads.releaseReferences(payload.id); assert.equal(f.data.payloads.getPayload(payload.id).refCount, 1);
  assert.throws(() => f.data.payloads.releaseReferences(payload.id), /FOREIGN KEY/);
  assert.equal(Buffer.from(f.data.payloads.readPayloadBytes(payload.id)).toString(), 'retained context');
  assert.throws(() => f.store.putBuildSnapshot({ ...build, snapshotId: 'missing', data: { payloadRef: 'missing-payload' } }), /missing\/uncommitted/);
});
test('uninstall metadata has no cascade into tabsets, config, history, bindings or domain data', async (t) => {
  const f = await fixture(t); await f.install(); const installed = f.store.getInstallation('test.notes');
  f.store.putTabset(tabset('ps_a'), 0); f.store.putGenerationSnapshot(snapshot(installed));
  f.data.db.exec("CREATE TABLE test_plugin_domain(id TEXT PRIMARY KEY, value TEXT); INSERT INTO test_plugin_domain VALUES ('result','retained');");
  const tables = ['sessions', 'chat_messages', 'session_runtime_bindings', 'plugin_session_tabsets', 'plugin_configurations', 'plugin_generation_snapshots', 'test_plugin_domain'];
  for (const name of tables) for (const fk of f.data.db.prepare(`PRAGMA foreign_key_list(${name})`).all()) assert.notEqual(fk.table, 'plugin_installations');
  f.store.putInstallation({ ...installed, state: 'uninstalled', enabled: false }, installed.stateRevision);
  assert.ok(f.store.getTabset('ps_a')); assert.ok(f.store.getGenerationSnapshot('ps_a', 'g1'));
  assert.equal(f.data.db.prepare('SELECT value FROM test_plugin_domain').get().value, 'retained');
});
