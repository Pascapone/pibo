import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, snapshot, uninstall, manifest } from './plugin-system-management-helpers.mjs';
import { PluginManager } from '../dist/plugins/manager.js';

test('A19/A20 exact revision reinstall repairs required dependency; history and snapshots never change', async (t) => {
  const f = await fixture(t); const initial = await f.active(); f.store.putGenerationSnapshot(snapshot(initial));
  const before = f.store.getGenerationSnapshot('ps_a', 'g1');
  await uninstall(f); const missing = f.manager.sessionRecovery('ps_a'); assert.equal(missing.status, 'blocked'); assert.equal(missing.canResume, false); assert.equal(missing.historyReadable, true);
  await f.install(); assert.equal(f.manager.sessionRecovery('ps_a').canResume, false);
  await f.manager.activate('test.notes', { expectedRevision: f.store.getInstallation('test.notes').stateRevision }); assert.equal(f.manager.sessionRecovery('ps_a').status, 'ready');
  assert.deepEqual(f.store.getGenerationSnapshot('ps_a', 'g1'), before);
});
test('A20 different version/hash needs explicit compatibility; optional missing contributions only degrade', async (t) => {
  const f = await fixture(t); const initial = await f.active(); f.store.putGenerationSnapshot(snapshot(initial)); await uninstall(f);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ version: '2.0.0' })));
  await f.install(); await f.manager.activate('test.notes', { expectedRevision: f.store.getInstallation('test.notes').stateRevision });
  assert.equal(f.manager.sessionRecovery('ps_a').canResume, false); assert.equal(f.manager.sessionRecovery('ps_a').diagnostics[0].code, 'plugin-revision-incompatible');
  const explicit = new PluginManager({ ...f.managerOptions, isCompatibleRevision: (_id, from, to) => from === initial.revision && to === f.store.getInstallation('test.notes').revision }); assert.equal(explicit.sessionRecovery('ps_a').canResume, true);
  const optional = { ...snapshot(initial, false), piboSessionId: 'ps_optional', generationId: 'g2', plan: { ...snapshot(initial, false).plan, piboSessionId: 'ps_optional', generation: 'g2' } }; f.store.putGenerationSnapshot(optional);
  await uninstall(f); assert.equal(f.manager.sessionRecovery('ps_optional').status, 'degraded'); assert.equal(f.manager.sessionRecovery('ps_optional').canResume, true);
});
test('legacy sessions without snapshots remain unknown, readable, and conservatively blocked', async (t) => {
  const f = await fixture(t); const recovery = f.manager.sessionRecovery('ps_legacy'); assert.equal(recovery.status, 'unknown'); assert.equal(recovery.canResume, false); assert.equal(recovery.historyReadable, true); assert.match(recovery.diagnostics[0].message, /Conservatively resolve/);
});
