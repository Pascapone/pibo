import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { PluginMigrationJournal } from '../dist/plugins/migration-journal.js';
import { fixture, tabset } from './plugin-system-management-helpers.mjs';
import { spawnSync } from 'node:child_process';
import { migratePluginProductState } from '../dist/plugins/product-state-migration.js';

test('A23 cross-store write/journal crash is resumed from owner postconditions without duplicate effects', async (t) => {
  const f = await fixture(t); const agents = new DatabaseSync(join(f.root, 'agents-fixture.sqlite')); t.after(() => agents.close());
  agents.exec('CREATE TABLE migrated_agents(id TEXT PRIMARY KEY, tools TEXT, revision INTEGER);');
  f.data.db.exec('CREATE TABLE migrated_plugin_settings(id TEXT PRIMARY KEY, config TEXT);');
  let agentWrites = 0; let productWrites = 0;
  const stages = [
    { id: 'agents', isApplied: () => !!agents.prepare("SELECT id FROM migrated_agents WHERE id='agent_a'").get(), apply: () => { agentWrites++; agents.prepare('INSERT INTO migrated_agents VALUES (?,?,?)').run('agent_a', '["read"]', 1); } },
    { id: 'settings', isApplied: () => !!f.data.db.prepare("SELECT id FROM migrated_plugin_settings WHERE id='app'").get(), apply: () => { productWrites++; f.data.db.prepare('INSERT INTO migrated_plugin_settings VALUES (?,?)').run('app', '{"description":"old scope preserved"}'); } },
  ];
  const input = { id: 'upgrade-v1', backup: Buffer.from('{"agent_a":{"nativeTools":["read"],"mcp":"old"}}'), backupRoot: join(f.root, 'backups'), stages };
  const journal = new PluginMigrationJournal(f.store);
  await assert.rejects(journal.run({ ...input, afterStageWrite(stage) { if (stage === 'agents') throw new Error('crash between stores'); } }), /crash between/);
  assert.equal(agentWrites, 1); assert.equal(productWrites, 0); assert.equal(f.store.getJournal(input.id).state, 'failed');
  const restarted = new PluginMigrationJournal(f.store); const done = await restarted.run(input); assert.equal(done.state, 'complete'); assert.equal(agentWrites, 1); assert.equal(productWrites, 1);
  assert.deepEqual(await readFile(done.backupPath), input.backup); await restarted.run(input); assert.equal(productWrites, 1);
  assert.equal(agents.prepare('SELECT tools FROM migrated_agents').get().tools, '["read"]');
});
test('A23 real SIGKILL between two SQLite owner stages resumes without losing old bytes or repeating applied writes', async (t) => {
  const f = await fixture(t); const ownerPath = join(f.root, 'actual-agent-fixture.sqlite');
  const owner = new DatabaseSync(ownerPath); t.after(() => owner.close()); owner.exec('CREATE TABLE converted(id TEXT PRIMARY KEY, writes INTEGER NOT NULL)');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {DatabaseSync} from 'node:sqlite';
    import {PiboDataStore} from './dist/data/pibo-store.js';
    import {PluginMigrationJournal} from './dist/plugins/migration-journal.js';
    const data = new PiboDataStore(${JSON.stringify(f.data.path)}, {payloadRootDir:${JSON.stringify(join(f.root, 'payloads'))}});
    const owner = new DatabaseSync(${JSON.stringify(ownerPath)});
    await new PluginMigrationJournal(data.plugins).run({id:'actual-crash',backup:Buffer.from('old-profile-bytes'),backupRoot:${JSON.stringify(join(f.root, 'backups'))},stages:[
      {id:'agent-owner',isApplied:()=>!!owner.prepare("SELECT id FROM converted WHERE id='agent'").get(),apply:()=>owner.prepare("INSERT INTO converted VALUES ('agent',1)").run()},
      {id:'product-owner',isApplied:()=>!!data.plugins.getConfig({scope:'app',pluginId:'test.notes'}),apply:()=>data.plugins.putConfig({target:{scope:'app',pluginId:'test.notes'},revision:0,schemaVersion:1,values:{description:'old'}},0)}
    ],afterStageWrite(stage){if(stage==='agent-owner')process.kill(process.pid,'SIGKILL')}});
  `], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr); assert.equal(f.store.getJournal('actual-crash').state, 'running'); assert.deepEqual(f.store.getJournal('actual-crash').completed, []);
  const target = { scope: 'app', pluginId: 'test.notes' };
  const done = await new PluginMigrationJournal(f.store).run({ id: 'actual-crash', backup: Buffer.from('old-profile-bytes'), backupRoot: join(f.root, 'backups'), stages: [
    { id: 'agent-owner', isApplied: () => !!owner.prepare("SELECT id FROM converted WHERE id='agent'").get(), apply: () => { throw new Error('must not repeat committed agent write'); } },
    { id: 'product-owner', isApplied: () => !!f.store.getConfig(target), apply: () => f.store.putConfig({ target, revision: 0, schemaVersion: 1, values: { description: 'old' } }, 0) },
  ] });
  assert.equal(done.state, 'complete'); assert.equal(owner.prepare('SELECT writes FROM converted').get().writes, 1); assert.equal(f.store.getConfig(target).values.description, 'old'); assert.equal(await readFile(done.backupPath, 'utf8'), 'old-profile-bytes');
});
test('product-state migration preserves explicit scopes and session ownership, and refuses existing independent tabsets', async (t) => {
  const f = await fixture(t); const target = { scope: 'agent', pluginId: 'test.notes', agentId: 'agent-a' };
  const input = { store: f.store, id: 'mapped-product-state', legacyBytes: Buffer.from('{"unknownPiPackage":"retained-inactive"}'), backupRoot: join(f.root, 'backups'), configurations: [{ target, schemaVersion: 1, revision: 0, values: { description: 'old-description' } }], tabsets: [tabset('ps_a')], ownerStages: [] };
  const dry = await migratePluginProductState({ ...input, dryRun: true }); assert.equal(dry.dryRun, true); assert.equal(f.store.getTabset('ps_a'), undefined);
  await migratePluginProductState(input); await migratePluginProductState(input); assert.equal(f.store.getConfig(target).values.description, 'old-description'); assert.equal(f.store.getTabset('ps_a').revision, 1); assert.equal(f.store.listInstallations().length, 0);
  f.store.putTabset(tabset('ps_b', 'independent-browser'), 0);
  await assert.rejects(migratePluginProductState({ ...input, id: 'other-browser', configurations: [], tabsets: [tabset('ps_b', 'global-legacy')] }), /cannot overwrite/);
  assert.equal(f.store.getTabset('ps_b').tabs[0].state.value, 'independent-browser');
});
test('migration dry-run is write-free and changed source/order or corrupted backup fails closed', async (t) => {
  const f = await fixture(t); let applied = false; const input = { id: 'migration', backup: Buffer.from('original bytes'), backupRoot: join(f.root, 'backup'), stages: [{ id: 'one', isApplied: () => applied, apply() { applied = true; } }] };
  const journal = new PluginMigrationJournal(f.store); const dry = await journal.run({ ...input, dryRun: true }); assert.equal(dry.dryRun, true); assert.equal(applied, false); assert.equal(f.store.getJournal(input.id), undefined); await assert.rejects(access(input.backupRoot));
  const result = await journal.run(input); await assert.rejects(journal.run({ ...input, backup: Buffer.from('changed') }), /source or stage order/);
  await assert.rejects(journal.run({ ...input, stages: [] }), /source or stage order/);
  await writeFile(result.backupPath, 'corruption'); await assert.rejects(journal.run(input), /corrupted/);
});
test('a process death with running checkpoint is recoverable and failed postconditions cannot complete', async (t) => {
  const f = await fixture(t); let writes = 0; const journal = new PluginMigrationJournal(f.store);
  const input = { id: 'incomplete', backup: Buffer.from('legacy'), backupRoot: join(f.root, 'backups'), stages: [{ id: 'write', isApplied: () => false, apply() { writes++; } }] };
  await assert.rejects(journal.run(input), /postcondition/); assert.equal(f.store.getJournal(input.id).state, 'failed');
  const previous = f.store.getJournal(input.id); f.store.putJournal({ ...previous, state: 'running', currentStage: 'write' }, previous.revision);
  const done = await journal.run({ ...input, stages: [{ id: 'write', isApplied: () => writes === 1, apply() { writes++; } }] });
  assert.equal(done.state, 'complete'); assert.equal(writes, 1);
});
