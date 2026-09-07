import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BoundedWorkerClient, boundedMessageBytes } from '../dist/data/bounded-worker-client.js';
import { AsyncChatStorage } from '../dist/data/async-chat-storage.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { ChatDataIngestService } from '../dist/data/ingest-service.js';
import { ChatSessionQueryService } from '../dist/apps/chat/data/session-query-service.js';
const controlled = new URL('./fixtures/storage-worker/controlled-worker.mjs', import.meta.url);

async function ready(client) {
  for (let i = 0; i < 300 && !client.status().ready; i++) await delay(10);
  assert.equal(client.status().ready, true);
}

test('slow worker CPU leaves the calling thread responsive and enforces queue counts and bytes', async () => {
  const client = new BoundedWorkerClient(controlled, { maxPending: 2, maxPendingBytes: 512, maxMessageBytes: 256, maxAgeMs: 1000 });
  try {
    await ready(client);
    const first = client.request({ blockMs: 150, value: 1 });
    const second = client.request({ value: 2 });
    await assert.rejects(client.request({ value: 3 }), { code: 'storage_overloaded' });
    const start = performance.now();
    await delay(10);
    assert.ok(performance.now() - start < 100, 'main-thread timer progresses while worker blocks');
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    await assert.rejects(client.request({ value: 'x'.repeat(1000) }), { code: 'storage_payload_limit' });
    assert.equal(client.status().pendingBytes, 0);
  } finally { await client.close(); }
});

test('admission bypasses queued background work without changing FIFO within a priority', async () => {
  const client = new BoundedWorkerClient(controlled, { maxAgeMs: 2000, agingMs: 1000 });
  try {
    await ready(client);
    const order = [];
    const request = (value, priority, blockMs = 0) => client.request({ value, blockMs }, { priority }).then(value => order.push(value));
    await Promise.all([request('active', 'background', 100), request('background', 'background'), request('first', 'admission'), request('second', 'admission')]);
    assert.deepEqual(order, ['active', 'first', 'second', 'background']);
  } finally { await client.close(); }
});

test('worker crash and execution deadline release all queued promises with uncertain in-flight state', async () => {
  for (const command of [{ type: 'crash' }, { blockMs: 5000 }]) {
    const client = new BoundedWorkerClient(controlled, { maxAgeMs: 100 });
    try {
      await ready(client);
      const first = client.request(command);
      const second = client.request({ value: 'must not execute' });
      const results = await Promise.allSettled([first, second]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[0].reason.code, 'storage_unknown');
      assert.equal(results[1].status, 'rejected');
      assert.equal(client.status().pendingBytes, 0);
      assert.equal(client.status().closed, true);
    } finally { await client.close(); }
  }
});

test('payload accounting rejects cycles, wide input and oversized UTF-8 strings', () => {
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => boundedMessageBytes(cycle, 1000), { code: 'storage_payload_limit' });
  assert.throws(() => boundedMessageBytes({ text: '🦊'.repeat(100) }, 100), { code: 'storage_payload_limit' });
  assert.throws(() => boundedMessageBytes(Array(100001).fill(0), 10000000), { code: 'storage_payload_limit' });
});

test('large payload compression finishes before the short metadata transaction', () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-payload-staging-'));
  const store = new PiboDataStore(join(root, 'data.sqlite'), { payloadRootDir: join(root, 'payloads') });
  try {
    const prepare = store.payloads.preparePayload.bind(store.payloads);
    const commit = store.payloads.commitPreparedPayload.bind(store.payloads);
    let preparedOutside = false, committedInside = false;
    store.payloads.preparePayload = (input) => { preparedOutside = !store.db.isTransaction; return prepare(input); };
    store.payloads.commitPreparedPayload = (input) => { committedInside = store.db.isTransaction; return commit(input); };
    const now = new Date().toISOString();
    new ChatDataIngestService(store).ingestUserMessageAccepted({
      session: { id: 'ps_payload', piSessionId: '', channel: 'web', kind: 'chat', profile: 'default', metadata: { chatRoomId: 'room_payload' }, createdAt: now, updatedAt: now },
      roomId: 'room_payload', actorId: 'test', text: 'x'.repeat(64 * 1024), clientTxnId: 'payload-one',
    });
    assert.equal(preparedOutside, true);
    assert.equal(committedInside, true);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('chat projections do not overwrite a concurrently advanced runtime binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-binding-projection-'));
  const store = new PiboDataStore(join(root, 'data.sqlite'), { payloadRootDir: join(root, 'payloads') });
  try {
    const now = new Date().toISOString();
    const staleSession = { id: 'ps_binding', piSessionId: 'native-old', channel: 'web', kind: 'chat', profile: 'default', metadata: { chatRoomId: 'room_binding' }, createdAt: now, updatedAt: now };
    store.sessions.upsertSession({ session: staleSession, roomId: 'room_binding' });
    store.db.prepare("UPDATE session_runtime_bindings SET native_session_id = 'native-live', revision = 9 WHERE pibo_session_id = ?").run(staleSession.id);
    new ChatDataIngestService(store).ingestUserMessageAccepted({ session: staleSession, roomId: 'room_binding', actorId: 'test', text: 'projection', clientTxnId: 'binding-one' });
    new ChatSessionQueryService(store).recordEvent({ type: 'assistant_message', piboSessionId: staleSession.id, eventId: 'turn-binding', text: 'done', renderSequence: 1 }, staleSession, 1, now);
    const binding = store.db.prepare('SELECT native_session_id, revision FROM session_runtime_bindings WHERE pibo_session_id = ?').get(staleSession.id);
    assert.deepEqual({ ...binding }, { native_session_id: 'native-live', revision: 9 });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('atomic worker admissions have one winner, persist after restart and avoid main-thread lock waiting', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-storage-isolation-'));
  const path = join(root, 'data.sqlite'), payloads = join(root, 'payloads');
  new PiboDataStore(path, { payloadRootDir: payloads }).close();
  let storage = new AsyncChatStorage(path, payloads, { maxAgeMs: 2000 });
  let lock;
  try {
    await ready(storage);
    const room = await storage.resolveRoom();
    const now = new Date().toISOString();
    const session = { id: 'ps_worker', piSessionId: '', channel: 'web', kind: 'chat', profile: 'default', metadata: { chatRoomId: room.id }, createdAt: now, updatedAt: now };
    const input = { piboSessionId: session.id, roomId: room.id, actorId: 'test', clientTxnId: 'one', eventType: 'user.message.accepted', retentionClass: 'chat_message', payload: { type: 'user.message.accepted', text: 'durable' } };
    const results = await Promise.all(Array.from({ length: 10 }, () => storage.admit(input, session, 'durable')));
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(new Set(results.map(result => result.event.streamId)).size, 1);
    await storage.close();
    const persisted = new PiboDataStore(path, { payloadRootDir: payloads });
    assert.equal(persisted.db.prepare('SELECT count(*) AS count FROM chat_messages WHERE session_id = ?').get(session.id).count, 1);
    assert.equal(persisted.db.prepare('SELECT count(*) AS count FROM sessions WHERE id = ?').get(session.id).count, 1);
    persisted.close();
    storage = new AsyncChatStorage(path, payloads, { maxAgeMs: 300 });
    await ready(storage);
    assert.equal((await storage.admit(input, session, 'durable')).created, false);
    lock = new DatabaseSync(path); lock.exec('BEGIN IMMEDIATE');
    const pending = storage.append({ ...input, clientTxnId: 'locked' });
    let pulses = 0;
    const pulse = setInterval(() => pulses++, 10);
    const result = await Promise.allSettled([pending]);
    clearInterval(pulse);
    assert.equal(result[0].status, 'rejected');
    assert.ok(pulses >= 5, 'control thread continues during writer lock');
    lock.exec('ROLLBACK'); lock.close(); lock = undefined;
    await storage.close();
    storage = new AsyncChatStorage(path, payloads, { maxAgeMs: 2000 });
    await ready(storage);
    assert.equal(await storage.find(room.id, 'test', 'locked'), undefined, 'no successful ACK or late insert for blocked write');
  } finally { if (lock) { lock.exec('ROLLBACK'); lock.close(); } await storage.close(); rmSync(root, { recursive: true, force: true }); }
});

test('room fairness rotates storage admission and reserves control queue space',async()=>{
 const client=new BoundedWorkerClient(controlled,{maxPending:6,reservedControlRequests:1,maxPendingBytes:4096,reservedControlBytes:256,maxAgeMs:2000,agingMs:1000});
 try {
  await ready(client);const order=[];
  const request=(value,key,priority='admission',blockMs=0)=>client.request({value,blockMs},{priority,fairnessKey:key}).then(value=>order.push(value));
  const first=request('active','noisy','admission',80);
  const noisy1=request('noisy-1','noisy');const noisy2=request('noisy-2','noisy');
  const quiet=request('quiet','quiet');const third=request('third','third');
  await assert.rejects(client.request({value:'overflow'}),{code:'storage_overloaded'});
  const control=request('control','control','control');
  await Promise.all([first,noisy1,noisy2,quiet,third,control]);
  assert.deepEqual(order,['active','control','quiet','third','noisy-1','noisy-2']);
  assert.equal(client.status().pendingBytes,0);
 } finally {await client.close();}
});


test('storage fairness remembers Rooms across drained bursts without delaying control work',async()=>{
 const client=new BoundedWorkerClient(controlled,{maxAgeMs:2000,agingMs:1000,admissionWindowMs:1});
 try {
  await ready(client);const order=[];
  const request=(value,key,priority='admission')=>client.request({value},{priority,fairnessKey:key}).then(value=>order.push(value));
  await request('quiet-baseline','quiet');
  await Promise.all([request('noisy-1','noisy'),request('quiet-1','quiet'),request('noisy-2','noisy')]);
  await request('status','control','control');
  await Promise.all([request('noisy-3','noisy'),request('quiet-2','quiet'),request('noisy-4','noisy')]);
  assert.ok(order.indexOf('quiet-2')<order.indexOf('noisy-3'),JSON.stringify(order));
 } finally {await client.close();}
});
