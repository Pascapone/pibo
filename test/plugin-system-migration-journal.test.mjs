import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { PluginMigrationJournal } from '../dist/plugins/migration-journal.js';
import { fixture, tabset } from './plugin-system-management-helpers.mjs';
import { spawnSync } from 'node:child_process';
import { migratePluginProductState } from '../dist/plugins/product-state-migration.js';
import { migrateLegacySessionDatabaseAtStartup } from '../dist/data/legacy-session-upgrade.js';
import { migrateBrowserV1Tabs } from '../dist/plugins/browser-v1-upgrade.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';

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
test('automatic startup migration imports the retained legacy session database with journal recovery and no runtime fallback', async (t) => {
  const f = await fixture(t); const sourcePath = join(f.root, 'pibo-sessions.sqlite'); const targetPath = join(f.root, 'automatic-pibo.sqlite');
  const source = new DatabaseSync(sourcePath);
  source.exec(`CREATE TABLE pibo_sessions(id TEXT PRIMARY KEY,pi_session_id TEXT,channel TEXT,kind TEXT,profile TEXT,parent_id TEXT,origin_id TEXT,workspace TEXT,title TEXT,metadata_json TEXT,active_model_json TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE pibo_session_runtime_bindings(pibo_session_id TEXT PRIMARY KEY,runtime_instance_id TEXT,runtime_adapter_id TEXT,native_session_id TEXT,binding_state TEXT,protocol TEXT,protocol_version TEXT,adapter_version TEXT,locator_json TEXT,metadata_json TEXT,revision INTEGER,created_at TEXT,updated_at TEXT);`);
  source.prepare('INSERT INTO pibo_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('ps_legacy', 'native-old', 'web', 'interactive', 'base', null, null, '/workspace', 'Legacy title', JSON.stringify({ chatRoomId: 'room_old' }), JSON.stringify({ provider: 'openai', model: 'old' }), '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  source.prepare('INSERT INTO pibo_session_runtime_bindings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('ps_legacy', 'pi', 'pi', 'native-old', 'bound', 'pi-sdk', '1', '0.85', JSON.stringify({ path: '/retained.jsonl' }), JSON.stringify({ retained: true }), 4, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  source.close();
  const interrupted = await migrateLegacySessionDatabaseAtStartup({ sourcePath, targetPath, backupRoot: join(f.root, 'session-backups'), afterStageWrite() { throw new Error('simulated process stop after owner commit'); } });
  assert.equal(interrupted.blocked.length, 1);
  const resumed = await migrateLegacySessionDatabaseAtStartup({ sourcePath, targetPath, backupRoot: join(f.root, 'session-backups') });
  assert.equal(resumed.alreadyApplied, 1); assert.equal(resumed.blocked.length, 0);
  const target = new PiboDataStore(targetPath);
  try {
    const row = target.db.prepare('SELECT title,room_id FROM sessions WHERE id=?').get('ps_legacy');
    const binding = target.db.prepare('SELECT runtime_instance_id,native_session_id,revision,metadata_json FROM session_runtime_bindings WHERE pibo_session_id=?').get('ps_legacy');
    assert.equal(row.title, 'Legacy title'); assert.equal(row.room_id, 'room_old');
    assert.equal(binding.runtime_instance_id, 'pi'); assert.equal(binding.native_session_id, 'native-old'); assert.equal(binding.revision, 4); assert.equal(JSON.parse(binding.metadata_json).retained, true);
    const journal = target.plugins.listJournals().find((entry) => entry.id.includes('ps_legacy'));
    assert.equal(journal.state, 'complete'); assert.match(journal.backupPath, /session-backups/);
  } finally { target.close(); }
  await access(sourcePath);
});

test('automatic startup migration preserves divergent target sessions and gives a precise repair result', async (t) => {
  const f = await fixture(t); const sourcePath = join(f.root, 'pibo-sessions.sqlite'); const targetPath = join(f.root, 'conflict-pibo.sqlite');
  const source = new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE pibo_sessions(id TEXT PRIMARY KEY,pi_session_id TEXT,channel TEXT,kind TEXT,profile TEXT,parent_id TEXT,origin_id TEXT,workspace TEXT,title TEXT,metadata_json TEXT,active_model_json TEXT,created_at TEXT,updated_at TEXT)');
  source.prepare('INSERT INTO pibo_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('ps_conflict', 'old-native', 'web', 'interactive', 'base', null, null, null, 'Legacy', '{}', null, '2026-01-01', '2026-01-02'); source.close();
  const target = new PiboDataStore(targetPath); target.db.prepare(`INSERT INTO sessions (id,pi_session_id,root_session_id,channel,kind,profile,title,status,metadata_json,created_at,updated_at,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ps_conflict', 'current-native', 'ps_conflict', 'web', 'interactive', 'base', 'Current', 'idle', '{}', '2026-02-01', '2026-02-02', '2026-02-02'); target.close();
  const report = await migrateLegacySessionDatabaseAtStartup({ sourcePath, targetPath, backupRoot: join(f.root, 'backups') });
  assert.equal(report.blocked.length, 1); assert.match(report.blocked[0].diagnostic, /cannot overwrite divergent target session/); assert.match(report.blocked[0].repair, /Do not delete or replace either database/);
  const reopened = new PiboDataStore(targetPath); try { assert.equal(reopened.db.prepare('SELECT title FROM sessions WHERE id=?').get('ps_conflict').title, 'Current'); } finally { reopened.close(); }
  await access(sourcePath);
});

test('first UI upgrade automatically imports only explicitly session-bound browser v1 tabs and retains unresolved source', async (t) => {
  const f = await fixture(t); const source = JSON.stringify({ version: 1, activeTabId: 'context-a', tabs: [
    { id: 'context-a', piboSessionId: 'ps_a', target: { kind: 'route', route: { area: 'context' } }, title: 'Context' },
    { id: 'plugin-a', target: { kind: 'plugin-view', piboSessionId: 'ps_a', viewId: 'test.notes/view', title: 'Notes' } },
    { id: 'unbound-settings', target: { kind: 'route', route: { area: 'settings' } }, title: 'Settings' },
  ] });
  const view = (id, title) => ({
    id, pluginId: id.split('/')[0], pluginRevision: 'rev-1',
    contribution: {
      id: id.split('/')[1], kind: 'view', title, scope: 'app', required: true, defaultEnabled: true, schemaVersion: 1,
      context: { kind: 'none', reason: 'test' },
      view: { title, exportName: 'View', presentation: 'workspace', instance: 'singleton', mount: 'unmount', stateSchemaVersion: 1, stateSchema: { type: 'object', additionalProperties: true }, ...(id === 'pibo.product-ui/user-resources' ? { subviews: [{ id: 'context-files', title: 'Context Files', purpose: 'content' }] } : {}) },
    },
  });
  const plan = { schemaVersion: 1, piboSessionId: 'ps_a', agentId: 'agent-a', runtime: { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, selection: { schemaVersion: 1, plugins: [] }, contributions: [view('pibo.product-ui/user-resources', 'User Resources'), view('test.notes/view', 'Notes')], resources: [], configurations: [], pluginConfigurations: [], nodes: [], diagnostics: [] };
  const input = { store: f.store, source, backupRoot: join(f.root, 'browser-backups'), assertSessionAccess(id) { assert.equal(id, 'ps_a'); }, async getSessionPlan() { return { plan }; } };
  const report = await migrateBrowserV1Tabs(input);
  assert.deepEqual(report.migratedSessions, ['ps_a']); assert.equal(report.unresolved.length, 1); assert.match(report.unresolved[0].reason, /No explicit Pibo Session identity/);
  const stored = f.store.getTabset('ps_a'); assert.equal(stored.tabs.length, 2); assert.equal(stored.tabs[0].viewId, 'pibo.product-ui/user-resources'); assert.equal(stored.activeTabId, stored.tabs[0].instanceId); assert.equal(stored.tabs[0].state.legacyDesktopTab.id, 'context-a');
  const repeated = await migrateBrowserV1Tabs(input); assert.deepEqual(repeated.alreadyAppliedSessions, ['ps_a']); assert.equal(f.store.getTabset('ps_a').revision, 1);
  const sourceJournal = f.store.getJournal(`pibo4-browser-v1-source:${report.sourceHash}`); assert.equal(sourceJournal.state, 'complete'); assert.equal(await readFile(sourceJournal.backupPath, 'utf8'), source);
  const concurrentSource = JSON.stringify({ version: 1, activeTabId: 'same', tabs: [{ id: 'same', target: { kind: 'plugin-view', piboSessionId: 'ps_b', viewId: 'test.notes/view', title: 'Notes' } }] });
  const concurrentInput = { ...input, source: concurrentSource, assertSessionAccess(id) { assert.equal(id, 'ps_b'); }, async getSessionPlan() { return { plan: { ...plan, piboSessionId: 'ps_b' } }; } };
  const concurrent = await Promise.all([migrateBrowserV1Tabs(concurrentInput), migrateBrowserV1Tabs(concurrentInput)]);
  assert.equal(concurrent.flatMap((entry) => entry.blocked).length, 0); assert.equal(f.store.getTabset('ps_b').tabs.length, 1); assert.equal(f.store.getTabset('ps_b').revision, 1);
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
