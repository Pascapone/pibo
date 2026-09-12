import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, uninstall, tabset, snapshot } from './plugin-system-management-helpers.mjs';
import { PluginManager } from '../dist/plugins/manager.js';
import { pluginImpact, createPluginConsumerCollector } from '../dist/plugins/operations.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { spawnSync } from 'node:child_process';

test('A17 unique sessions and required/optional/historical/unknown usage are separate from profiles/runs', () => {
  const consumers = [{ kind: 'session', id: 'ps_a', usage: 'required' }, { kind: 'session', id: 'ps_a', usage: 'active' }, { kind: 'session', id: 'ps_b', usage: 'optional' }, { kind: 'session', id: 'ps_c', usage: 'historical' }, { kind: 'session', id: 'ps_d', usage: 'unknown' }, { kind: 'profile', id: 'agent-a', usage: 'required' }, { kind: 'run', id: 'run-a', usage: 'active' }];
  const impact = pluginImpact([...consumers, ...consumers]); assert.equal(impact.sessionCount, 4); assert.deepEqual(impact.profiles, ['agent-a']); assert.deepEqual(impact.sessions.unknown, ['ps_d']); assert.deepEqual(impact.runs, ['run-a']); assert.equal(impact.sessionsPreserved, true);
});
test('A17 wrong text, expired plan, stale revision and unavailable collector mutate nothing', async (t) => {
  let now = new Date('2026-09-12T00:00:00Z'); const f = await fixture(t, { manager: { now: () => now } }); await f.active();
  const plan = await f.manager.planUninstall('test.notes', { ttlMs: 10 }); const before = f.store.getInstallation('test.notes');
  await assert.rejects(f.manager.confirmUninstall({ planId: plan.id, pluginIdText: 'wrong', expectedRevision: before.stateRevision }), /exact plugin/);
  await assert.rejects(f.manager.confirmUninstall({ planId: plan.id, pluginIdText: 'test.notes', expectedRevision: before.stateRevision - 1 }), /changed/);
  now = new Date(now.getTime() + 20); await assert.rejects(f.manager.confirmUninstall({ planId: plan.id, pluginIdText: 'test.notes', expectedRevision: before.stateRevision }), /expired/);
  assert.deepEqual(f.store.getInstallation('test.notes'), before); assert.equal(f.stops, 1);
  const noCollector = new PluginManager({ ...f.managerOptions, collectConsumers: undefined }); await assert.rejects(noCollector.planUninstall('test.notes'), /collector/);
});
test('A18 consumers changing after preview and during cleanup require new confirmation', async (t) => {
  const f = await fixture(t); await f.active(); const plan = await f.manager.planUninstall('test.notes');
  f.setConsumers([{ kind: 'session', id: 'ps_new', usage: 'required' }]);
  await assert.rejects(f.manager.confirmUninstall({ planId: plan.id, pluginIdText: 'test.notes', expectedRevision: plan.installationRevision }), /consumers changed/);
  assert.equal(f.store.getInstallation('test.notes').state, 'active');
  f.setConsumers([]); const stop = f.lifecycle.deactivate; f.lifecycle.deactivate = async () => { await stop(); f.setConsumers([{ kind: 'session', id: 'ps_race', usage: 'required' }]); };
  const result = await uninstall(f); assert.equal(result.state, 'awaiting-confirmation'); assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
});
test('A18 retirement denies new activation, drains rather than aborts, cancellation restores admission', async (t) => {
  const f = await fixture(t); await f.active(); f.setConsumers([{ kind: 'run', id: 'run_live', usage: 'active' }]);
  const op = await uninstall(f); assert.equal(op.state, 'draining'); assert.match(op.diagnostic, /run_live/);
  assert.throws(() => f.manager.assertCanActivate(['test.notes']), /retiring/); assert.equal(f.stops, 1);
  await f.manager.cancelOperation(op.id); f.manager.assertCanActivate(['test.notes']);
  const again = await uninstall(f); f.setConsumers([]); await f.manager.resumeOperation(again.id); assert.equal(f.store.getInstallation('test.notes').state, 'uninstalled');
});
test('A19 installation tombstone retains tabsets, configuration, snapshots and unrelated records', async (t) => {
  const f = await fixture(t); const installation = await f.active();
  f.data.sessions.upsertSession({ roomId: 'room_retained', session: { id: 'ps_a', piSessionId: 'pi_retained', channel: 'pibo.test', kind: 'chat', profile: 'default', title: 'Retained Session', createdAt: installation.createdAt, updatedAt: installation.createdAt } });
  f.data.messages.insertMessage({ id: 'msg_retained', sessionId: 'ps_a', sequence: 1, role: 'assistant', status: 'complete', createdAt: installation.createdAt, contentPreview: 'Retained history', attributes: { toolResult: 'retained result' } });
  f.data.db.exec("CREATE TABLE test_notes_domain(id TEXT PRIMARY KEY, pibo_session_id TEXT, result TEXT); INSERT INTO test_notes_domain VALUES ('note','ps_a','retained plugin result')");
  const beforeRows = ['sessions', 'chat_messages', 'session_runtime_bindings', 'test_notes_domain'].map((table) => f.data.db.prepare(`SELECT * FROM ${table}`).all());
  f.store.putTabset(tabset('ps_a'), 0); f.store.putGenerationSnapshot(snapshot(installation));
  const target = { scope: 'session', pluginId: 'test.notes', piboSessionId: 'ps_a' }; f.store.putConfig({ target, schemaVersion: 1, revision: 0, values: { description: 'retained' } }, 0);
  const payload = f.data.payloads.writePayload({ value: 'retained tool result', retentionClass: 'plugin_snapshot' });
  f.store.putBuildSnapshot({ piboSessionId: 'ps_a', generationId: 'g1', snapshotId: 'b1', kind: 'actual', data: { payloadRef: payload.id }, createdAt: installation.createdAt });
  const original = { tabs: f.store.getTabset('ps_a'), generation: f.store.getGenerationSnapshot('ps_a', 'g1'), config: f.store.getConfig(target), build: f.store.getBuildSnapshot('ps_a', 'b1') };
  await uninstall(f); assert.deepEqual({ tabs: f.store.getTabset('ps_a'), generation: f.store.getGenerationSnapshot('ps_a', 'g1'), config: f.store.getConfig(target), build: f.store.getBuildSnapshot('ps_a', 'b1') }, original);
  assert.deepEqual(['sessions', 'chat_messages', 'session_runtime_bindings', 'test_notes_domain'].map((table) => f.data.db.prepare(`SELECT * FROM ${table}`).all()), beforeRows);
  assert.equal(f.data.messages.listMessages('ps_a')[0].contentPreview, 'Retained history');
  assert.equal(Buffer.from(f.data.payloads.readPayloadBytes(payload.id)).toString(), 'retained tool result');
});
test('A21 crashes at drain and cleanup restart idempotently; failed disposal cannot claim success', async (t) => {
  const f = await fixture(t); await f.active();
  let crash = 'draining'; const manager = new PluginManager({ ...f.managerOptions, checkpoint(stage) { if (stage === crash) throw new Error('power loss'); } });
  const plan = await manager.planUninstall('test.notes'); await assert.rejects(manager.confirmUninstall({ planId: plan.id, pluginIdText: 'test.notes', expectedRevision: plan.installationRevision }), /power loss/);
  assert.equal(f.store.getOperation(plan.id).state, 'draining');
  crash = 'stopping'; await assert.rejects(manager.resumeOperation(plan.id), /power loss/);
  assert.equal(f.store.getOperation(plan.id).state, 'stopping');
  let recovered = await f.manager.recover(); assert.equal(recovered.at(-1).state, 'failed'); assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
  f.setHostState('inactive'); recovered = await f.manager.recover(); assert.equal(recovered.at(-1).state, 'complete');
  await f.install(); await f.manager.activate('test.notes', { expectedRevision: f.store.getInstallation('test.notes').stateRevision });
  f.lifecycle.deactivate = async () => { throw new Error('listener still alive'); }; const failed = await uninstall(f); assert.equal(failed.state, 'failed'); assert.match(failed.diagnostic, /listener still alive/); assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
});
test('A21 actual process kill after durable retirement is recovered without deleting product history', async (t) => {
  const f = await fixture(t); await f.active(); f.store.putTabset(tabset('ps_retained'), 0); const plan = await f.manager.planUninstall('test.notes');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {PiboDataStore} from './dist/data/pibo-store.js';
    import {PluginManager} from './dist/plugins/manager.js';
    const data = new PiboDataStore(${JSON.stringify(f.data.path)}, {payloadRootDir:${JSON.stringify(f.root + '/payloads')}});
    const manager = new PluginManager({store:data.plugins,artifactRoot:${JSON.stringify(f.managerOptions.artifactRoot)},collectConsumers:async()=>[],lifecycle:{activate:async()=>{},deactivate:async()=>{},status:async()=>'active'},checkpoint(stage){if(stage==='draining')process.kill(process.pid,'SIGKILL')}});
    await manager.confirmUninstall({planId:${JSON.stringify(plan.id)},pluginIdText:'test.notes',expectedRevision:${plan.installationRevision}});
  `], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr); assert.equal(f.store.getOperation(plan.id).state, 'draining'); assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
  assert.throws(() => f.manager.reserveGeneration({ piboSessionId: 'ps_after_crash', generationId: 'g_new', pluginIds: ['test.notes'] }), /retiring/);
  const recovered = await f.manager.recover(); assert.equal(recovered.at(-1).state, 'complete'); assert.equal(f.store.getTabset('ps_retained').tabs[0].state.value, 'A');
});
test('A18 persisted generation reservations close the read/async-setup retirement race across connections', async (t) => {
  const f = await fixture(t); await f.active(); const preview = await f.manager.planUninstall('test.notes');
  const second = new PiboDataStore(f.data.path, { payloadRootDir: f.root + '/payloads' }); t.after(() => second.close());
  const other = new PluginManager({ ...f.managerOptions, store: second.plugins });
  const reservation = other.reserveGeneration({ piboSessionId: 'ps_racing', generationId: 'g_racing', pluginIds: ['test.notes'] });
  await assert.rejects(f.manager.confirmUninstall({ planId: preview.id, pluginIdText: 'test.notes', expectedRevision: preview.installationRevision }), /consumers changed/);
  const operation = await uninstall(f); assert.equal(operation.state, 'draining'); assert.equal(operation.impact.sessionCount, 1);
  assert.throws(() => other.reserveGeneration({ piboSessionId: 'ps_late', generationId: 'g_late', pluginIds: ['test.notes'] }), /retiring/);
  assert.throws(() => other.releaseGenerationAdmission('ps_racing', 'g_racing', 0), /changed/);
  other.releaseGenerationAdmission('ps_racing', 'g_racing', reservation.revision);
  await f.manager.resumeOperation(operation.id); assert.equal(f.store.getInstallation('test.notes').state, 'uninstalled');
  assert.throws(() => other.reserveGeneration({ piboSessionId: 'ps_racing', generationId: 'g_racing', pluginIds: ['test.notes'] }), /reused/);
});
test('cancellation after confirmed cleanup restores the exact prior revision without losing consumers', async (t) => {
  const f = await fixture(t); const before = await f.active(); const stop = f.lifecycle.deactivate;
  f.lifecycle.deactivate = async () => { await stop(); f.setConsumers([{ kind: 'session', id: 'ps_late', usage: 'required' }]); };
  const operation = await uninstall(f); assert.equal(operation.state, 'awaiting-confirmation');
  const cancelled = await f.manager.cancelOperation(operation.id); assert.equal(cancelled.state, 'cancelled');
  assert.equal(f.store.getInstallation('test.notes').revision, before.revision); f.manager.assertCanActivate(['test.notes']); assert.equal(f.starts, 2);
});
test('collector reads existing product sessions and injected owner stores without a duplicate session database', async (t) => {
  const f = await fixture(t); const installation = await f.active();
  for (const id of ['ps_a', 'ps_legacy']) f.data.sessions.upsertSession({ roomId: 'room_a', session: { id, channel: 'pibo.test', kind: 'chat', profile: 'default', createdAt: installation.createdAt, updatedAt: installation.createdAt } });
  f.store.putGenerationSnapshot(snapshot(installation));
  const collect = createPluginConsumerCollector({ store: f.data, collectLive: async () => [{ kind: 'run', id: 'run_a', usage: 'active' }], collectProfiles: async () => [{ kind: 'profile', id: 'default', usage: 'required' }] });
  const impact = pluginImpact(await collect('test.notes')); assert.equal(impact.sessionCount, 2); assert.deepEqual(impact.sessions.unknown, ['ps_legacy']); assert.deepEqual(impact.sessions.required, ['ps_a']); assert.deepEqual(impact.profiles, ['default']); assert.deepEqual(impact.runs, ['run_a']);
});
test('A21 interrupted activation never results in two active revisions or implicit recovery import', async (t) => {
  const f = await fixture(t); await f.install();
  const manager = new PluginManager({ ...f.managerOptions, checkpoint(stage) { if (stage === 'activated') throw new Error('crash before commit'); } });
  await assert.rejects(manager.activate('test.notes', { expectedRevision: 1 }), /crash before commit/);
  assert.equal(f.starts, 1); const result = await f.manager.recover(); assert.equal(result.at(-1).state, 'failed'); assert.equal(f.starts, 1);
  f.setHostState('inactive'); const next = await f.manager.recover(); assert.equal(next.at(-1).state, 'complete'); assert.equal(f.store.listInstallations().filter((p) => p.state === 'active').length, 1);
});
