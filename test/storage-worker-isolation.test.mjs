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
const completionBeforeStall = new URL('./fixtures/storage-worker/completion-before-stall-worker.mjs', import.meta.url);

test('closing storage forbids creating a lazy reader and waits for failed worker exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-storage-close-'));
  const path = join(root, 'data.sqlite'), payloads = join(root, 'payloads');
  new PiboDataStore(path, { payloadRootDir: payloads }).close();
  const storage = new AsyncChatStorage(path, payloads);
  try {
    await ready(storage);
    await storage.close();
    await assert.rejects(storage.find('room', 'actor', 'txn'), { code: 'storage_closed' });
    assert.equal(storage.reader, undefined, 'no worker is created after disposal');
  } finally { await storage.close(); rmSync(root, { recursive: true, force: true }); }
  const client = new BoundedWorkerClient(controlled, { maxAgeMs: 1000 });
  await ready(client);
  const closing = client.close();
  await client.close();
  assert.equal(client.status().exited, true, 'every close call awaits the same worker termination');
  await closing;
});

async function ready(client) {
  for (let i = 0; i < 300 && !client.status().ready; i++) await delay(10);
  assert.equal(client.status().ready, true);
}

test('async output ingest returns compaction enrichments to the live event object', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-storage-compaction-enrichment-'));
  const path = join(root, 'data.sqlite'), payloads = join(root, 'payloads');
  const now = '2026-09-08T12:00:00.000Z';
  const session = { id: 'ps_async_compaction', piSessionId: '', channel: 'web', kind: 'chat', profile: 'default', metadata: {}, createdAt: now, updatedAt: now };
  const store = new PiboDataStore(path, { payloadRootDir: payloads });
  new ChatDataIngestService(store).ingestOutputEvent({
    session,
    actorId: 'test',
    event: {
      type: 'tool_execution_finished',
      piboSessionId: session.id,
      eventId: 'turn-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: 'done',
      isError: false,
      toolMetrics: { durationMs: 10, inputTokens: 1, outputTokens: 42, tokenBasis: 'tiktoken/cl100k_base' },
    },
  });
  store.close();

  const storage = new AsyncChatStorage(path, payloads);
  const event = {
    type: 'compaction_end',
    piboSessionId: session.id,
    eventId: 'turn-1',
    compactionIndex: 0,
    reason: 'codex_context_compaction',
    result: { type: 'contextCompaction', id: 'native-compaction-1' },
    aborted: false,
  };
  try {
    await ready(storage);
    const result = await storage.ingestOutput({ session, actorId: 'test', event });
    const expected = {
      toolCallCount: 1,
      maxToolOutputTokens: 42,
      maxToolOutputTokenBasis: 'tiktoken/cl100k_base',
    };
    assert.deepEqual(result.enrichment?.compactionStats, expected);
    assert.deepEqual(event.compactionStats, expected);

    const { compactionStats: _discarded, ...replayEvent } = event;
    const replay = await storage.ingestOutput({ session, actorId: 'test', event: replayEvent });
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.enrichment?.compactionStats, expected);
    assert.deepEqual(replayEvent.compactionStats, expected);
  } finally {
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

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

test('a committed completion queued before a caller stall wins over the expired timer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-storage-caller-stall-'));
  const path = join(root, 'fixture.sqlite');
  const completion = new SharedArrayBuffer(4);
  const client = new BoundedWorkerClient(completionBeforeStall, {
    maxAgeMs: 100,
    workerOptions: { workerData: { path, completion } },
  });
  try {
    await ready(client);
    await new Promise((resolve) => setImmediate(resolve));
    const request = client.request({ operation: 'commit' }, { timeoutMs: 100 });
    const completionView = new Int32Array(completion);
    const barrier = Atomics.wait(completionView, 0, 0, 1000);
    assert.ok(barrier === 'ok' || barrier === 'not-equal');
    assert.equal(Atomics.load(completionView, 0), 1, 'the worker posted completion before the caller stall');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    assert.equal(await request, 'committed');
    assert.equal(client.status().closed, false);
    assert.equal(client.status().completed, 1);
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(db.prepare('SELECT count(*) AS count FROM effects').get().count, 1); }
    finally { db.close(); }
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
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

test('a queued request expires without fencing a healthy in-flight worker', async () => {
  const client = new BoundedWorkerClient(controlled, { maxAgeMs: 1000 });
  try {
    await ready(client);
    const inFlight = client.request({ blockMs: 150, value: 'committed' });
    const queued = client.request({ value: 'too-late' }, { timeoutMs: 30 });
    await assert.rejects(queued, { code: 'storage_deadline' });
    assert.equal(await inFlight, 'committed');
    assert.equal(client.status().closed, false);
    assert.equal(await client.request({ value: 'still-healthy' }), 'still-healthy');
  } finally { await client.close(); }
});

test('close fences an in-flight unknown result, rejects queued work, and forbids reuse', async () => {
  const client = new BoundedWorkerClient(controlled, { maxAgeMs: 1000 });
  await ready(client);
  const inFlight = client.request({ blockMs: 500, value: 'must-not-ack' });
  const queued = client.request({ value: 'must-not-run' });
  const settled = Promise.allSettled([inFlight, queued]);
  await delay(20);
  await client.close();
  const [inFlightResult, queuedResult] = await settled;
  assert.equal(inFlightResult.status, 'rejected');
  assert.equal(inFlightResult.reason.code, 'storage_unknown');
  assert.equal(queuedResult.status, 'rejected');
  assert.equal(queuedResult.reason.code, 'storage_closed');
  await assert.rejects(client.request({ value: 'after-close' }), { code: 'storage_closed' });
  assert.equal(client.status().closed, true);
  assert.equal(client.status().pendingBytes, 0);
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

 test('payload accounting permits shared acyclic metadata and counts every serialized occurrence', () => {
  const model={provider:'test',id:'model'};
  const shared={model,options:{model}};
  const copied={model:{...model},options:{model:{...model}}};
  assert.equal(boundedMessageBytes(shared,4096),boundedMessageBytes(copied,4096));
  assert.throws(()=>boundedMessageBytes(shared,boundedMessageBytes({model},4096)),{code:'storage_payload_limit'});
  const cycle={model};cycle.self=cycle;
  assert.throws(()=>boundedMessageBytes(cycle,4096),{code:'storage_payload_limit'});
 });

test('an exited storage worker is replaced instead of disabling durable admission permanently', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pibo-storage-restart-'));
  const path = join(root, 'data.sqlite'), payloads = join(root, 'payloads');
  new PiboDataStore(path, { payloadRootDir: payloads }).close();
  const storage = new AsyncChatStorage(path, payloads, { maxAgeMs: 2000 });
  try {
    await ready(storage);
    const room = await storage.resolveRoom();
    const now = new Date().toISOString();
    const session = { id: 'ps_restart', piSessionId: '', channel: 'web', kind: 'chat', profile: 'default', metadata: { chatRoomId: room.id }, createdAt: now, updatedAt: now };
    const input = (clientTxnId) => ({ piboSessionId: session.id, roomId: room.id, actorId: 'test', clientTxnId, eventType: 'user.message.accepted', retentionClass: 'chat_message', payload: { type: 'user.message.accepted', text: 'durable' } });
    assert.equal((await storage.admit(input('restart-one'), session, 'durable')).created, true);

    const crashedWorker = storage.writer.worker;
    await crashedWorker.terminate();
    assert.equal(storage.status().writer.exited, true);
    // Inside the bounded replacement window the failure stays visible and is never a false ACK.
    await assert.rejects(storage.append(input('restart-two')), (error) => ['storage_closed', 'storage_worker_failed', 'storage_unknown'].includes(error.code));
    await delay(1100);

    // The replacement reopens the same durable store: the committed admission is found, not replayed.
    assert.equal((await storage.admit(input('restart-one'), session, 'durable')).created, false);
    assert.equal((await storage.admit(input('restart-two'), session, 'durable')).created, true);
    assert.equal(storage.status().restarts.writer, 1);
    assert.notEqual(storage.writer.worker, crashedWorker);
    assert.equal(storage.status().ready, true);

    const persisted = new PiboDataStore(path, { payloadRootDir: payloads });
    try {
      assert.equal(persisted.db.prepare('SELECT count(*) AS count FROM chat_messages WHERE session_id = ?').get(session.id).count, 2);
    } finally { persisted.close(); }
  } finally { await storage.close(); rmSync(root, { recursive: true, force: true }); }
});


