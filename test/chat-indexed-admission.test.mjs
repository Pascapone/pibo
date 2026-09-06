import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { ChatEventCommandService, chatClientTransactionKey } from '../dist/apps/chat/data/event-command-service.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pibo-indexed-admission-'));
  const store = new PiboDataStore(join(dir, 'data.sqlite'), { payloadRootDir: join(dir, 'payloads') });
  return { store, commands: new ChatEventCommandService(store), close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const message = (overrides = {}) => ({ roomId: 'room_a', actorId: 'actor_a', piboSessionId: 'ps_a', actorType: 'user', eventType: 'user.message.accepted', retentionClass: 'chat_message', clientTxnId: 'txn_a', payload: { type: 'user.message.accepted', text: 'original' }, ...overrides });

test('indexed admission preserves room/actor scope and original content across session retries', () => {
  const f = fixture();
  try {
    const original = f.commands.appendEvent(message());
    const duplicate = f.commands.appendEvent(message({ piboSessionId: 'ps_other', payload: { type: 'user.message.accepted', text: 'changed' } }));
    assert.deepEqual(duplicate, original);
    assert.deepEqual(f.commands.findByClientTxn('room_a', 'actor_a', 'txn_a'), original);
    assert.notEqual(f.commands.appendEvent(message({ roomId: 'room_b' })).streamId, original.streamId);
    assert.notEqual(f.commands.appendEvent(message({ actorId: 'actor_b' })).streamId, original.streamId);
    assert.equal(f.commands.findByClientTxn(undefined, 'actor_a', 'txn_a'), undefined);
    assert.equal(f.commands.findByClientTxn('room_a', undefined, 'txn_a'), undefined);
    for (const scope of [{ roomId: undefined }, { actorId: undefined }, { roomId: '', actorId: '' }]) {
      assert.equal(f.commands.appendEvent(message(scope)).streamId, f.commands.appendEvent(message(scope)).streamId);
    }
    const emptyA = f.commands.appendEvent(message({ clientTxnId: '' }));
    const emptyB = f.commands.appendEvent(message({ clientTxnId: '' }));
    assert.notEqual(emptyA.streamId, emptyB.streamId, 'empty transaction does not deduplicate inserts');
    assert.deepEqual(f.commands.findByClientTxn('room_a', 'actor_a', ''), emptyA);
  } finally { f.close(); }
});

test('large history admission uses the unique key index for hits and misses without a command-layer precheck', () => {
  const f = fixture();
  try {
    f.store.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
      INSERT INTO event_log (room_id, topic, type, source, idempotency_key, retention_class, attributes_json, created_at)
      SELECT 'room_a', 'pibo.output', 'tool_execution_finished', 'test', 'fixture:' || x, 'trace_event', '{"toolName":"read","summary":"fixture output"}', '2026-09-06T00:00:00Z' FROM n`);
    const original = f.commands.appendEvent(message());
    const prepare = f.store.db.prepare.bind(f.store.db);
    const statements = [];
    f.store.db.prepare = (sql) => { statements.push(sql); return prepare(sql); };
    assert.equal(f.commands.findByClientTxn('room_a', 'actor_a', 'txn_a').streamId, original.streamId);
    assert.equal(f.commands.findByClientTxn('room_a', 'actor_a', 'miss'), undefined);
    assert.equal(statements.length, 2);
    for (const sql of statements) {
      assert.doesNotMatch(sql, /json_extract|room_id\s*=/);
      for (const key of ['txn_a', 'miss']) {
        const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`).all(chatClientTransactionKey('room_a', 'actor_a', key));
        assert.match(plan.map(row => row.detail).join('\n'), /SEARCH event_log USING INDEX idx_event_log_idempotency/);
      }
    }
    f.commands.findByClientTxn = () => { throw new Error('redundant command lookup'); };
    assert.equal(f.commands.appendEvent(message()).streamId, original.streamId);
  } finally { f.close(); }
});

test('independent processes inserting the same transaction converge on one durable event', { timeout: 15000 }, async () => {
  const { spawn } = await import('node:child_process');
  const f = fixture();
  const children = [];
  try {
    const code = `
      import { DatabaseSync } from 'node:sqlite';
      import { PiboEventLogStore } from ${JSON.stringify(new URL('../dist/data/event-log.js', import.meta.url).href)};
      import { ChatEventCommandService } from ${JSON.stringify(new URL('../dist/apps/chat/data/event-command-service.js', import.meta.url).href)};
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA busy_timeout=1000');
      const commands = new ChatEventCommandService({ db, eventLog: new PiboEventLogStore(db) });
      process.send({ ready: true });
      process.once('message', () => {
        const event = commands.appendEvent(${JSON.stringify(message())});
        db.close(); process.send({ streamId: event.streamId }); process.disconnect();
      });`;
    const ready = [];
    const results = [];
    for (let i = 0; i < 2; i++) {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, f.store.path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.push(child);
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      ready.push(new Promise((resolve, reject) => {
        child.once('error', reject);
        child.on('message', msg => { if (msg.ready) resolve(); });
        child.once('exit', code => { if (code !== 0) reject(new Error(stderr)); });
      }));
      results.push(new Promise((resolve, reject) => {
        let streamId;
        child.once('error', reject);
        child.on('message', msg => { if (msg.streamId) streamId = msg.streamId; });
        child.once('exit', code => code === 0 && streamId ? resolve(streamId) : reject(new Error(stderr)));
      }));
    }
    await Promise.all(ready);
    for (const child of children) child.send('insert');
    const ids = await Promise.all(results);
    assert.equal(ids[0], ids[1]);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM event_log').get().count, 1);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    f.close();
  }
});

test('all-room snapshot audit rejects noncanonical transactions without changing the snapshot', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const f = fixture();
  try {
    f.commands.appendEvent(message());
    f.commands.appendEvent(message({ roomId: 'room_other', clientTxnId: 'second' }));
    const path = new URL('../scripts/audit-chat-transaction-keys.mjs', import.meta.url).pathname;
    const good = JSON.parse((await run(process.execPath, [path, '--snapshot', f.store.path, '--batch-size', '1'])).stdout);
    assert.equal(good.canonical, 2);
    assert.equal(good.compatible, true);
    f.store.db.prepare('UPDATE event_log SET idempotency_key = NULL WHERE room_id = ?').run('room_other');
    await assert.rejects(run(process.execPath, [path, '--snapshot', f.store.path]), error => {
      const result = JSON.parse(error.stdout);
      assert.equal(error.code, 2);
      assert.equal(result.noncanonical, 1);
      assert.equal(result.compatible, false);
      return true;
    });
    assert.equal(f.store.db.prepare('SELECT idempotency_key FROM event_log WHERE room_id = ?').get('room_other').idempotency_key, null);
  } finally { f.close(); }
});
