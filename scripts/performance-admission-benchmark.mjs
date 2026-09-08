import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { ChatEventCommandService, chatClientTransactionKey } from '../dist/apps/chat/data/event-command-service.js';

const { values } = parseArgs({ options: { help: { type: 'boolean' }, events: { type: 'string', default: '1000000' }, samples: { type: 'string', default: '10000' }, output: { type: 'string' } } });
if (values.help) {
  console.log('Isolated synthetic indexed-admission benchmark. Run inside a Docker worker.\nOptions: --events <n> --samples <n> --output <json-path>\nCreates and removes its own temporary database; does not open production data.');
  process.exit(0);
}
const count = Number(values.events), samples = Number(values.samples);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000000 || !Number.isSafeInteger(samples) || samples < 1 || samples > 100000) throw new Error('Invalid bounded events/samples');
const root = mkdtempSync(join(tmpdir(), 'pibo-admission-benchmark-'));
const store = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') });
const commands = new ChatEventCommandService(store);
try {
  const insert = store.db.prepare(`INSERT INTO event_log(room_id, session_id, topic, type, source, idempotency_key, retention_class, attributes_json, created_at) VALUES('room_bench', ?, 'pibo.output', 'tool_execution_finished', 'benchmark', ?, 'trace_event', ?, '2026-09-06T00:00:00Z')`);
  const attributes = JSON.stringify({ toolName: 'read', inlinePayload: { type: 'tool_execution_finished', summary: 'Representative synthetic tool output. '.repeat(24) } });
  for (let offset = 0; offset < count; offset += 1000) store.transaction(() => {
    for (let i = offset; i < Math.min(offset + 1000, count); i++) insert.run(`ps_bench_${i % 10}`, `fixture:${i}`, attributes);
  });
  const accepted = commands.appendEvent({ roomId: 'room_bench', actorId: 'actor_bench', piboSessionId: 'ps_bench_0', clientTxnId: 'hit', eventType: 'user.message.accepted', retentionClass: 'chat_message', payload: { type: 'user.message.accepted', text: 'benchmark' } });
  const oldSql = "SELECT * FROM event_log WHERE room_id = ? AND actor_id = ? AND json_extract(attributes_json, '$.clientTxnId') = ? ORDER BY stream_id ASC LIMIT 1";
  const old = store.db.prepare(oldSql);
  const measure = (fn, n) => { const values = []; for (let i = 0; i < n; i++) { const start = performance.now(); fn(i); values.push(performance.now() - start); } values.sort((a,b) => a-b); const p = q => values[Math.min(values.length - 1, Math.ceil(q * values.length) - 1)]; return { samples: n, p50: p(.5), p95: p(.95), p99: p(.99), p999: p(.999), max: values.at(-1) }; };
  const result = {
    at: new Date().toISOString(), node: process.version, sqlite: store.db.prepare('select sqlite_version() as version').get().version,
    host: { cpus: cpus().length, totalmem: totalmem() }, fixture: { events: count + 1, attributesBytes: Buffer.byteLength(attributes), databaseBytes: statSync(store.path).size },
    cache: 'Synthetic dataset populated immediately before measurement; repeated reads without OS cache eviction; physical cache residency unverified. This is a lookup benchmark, not an HTTP capacity or cold-cache claim.',
    pragmas: { synchronous: store.db.prepare('PRAGMA synchronous').get(), journalMode: store.db.prepare('PRAGMA journal_mode').get() },
    indexedPlan: store.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM event_log WHERE idempotency_key = ? LIMIT 1').all(chatClientTransactionKey('room_bench', 'actor_bench', 'hit')),
    oldPlan: store.db.prepare(`EXPLAIN QUERY PLAN ${oldSql}`).all('room_bench', 'actor_bench', 'hit'),
    oldHitMs: measure(() => old.get('room_bench', 'actor_bench', 'hit'), 3),
    oldMissMs: measure(() => old.get('room_bench', 'actor_bench', 'miss'), 3),
    indexedHitMs: measure(() => { if (commands.findByClientTxn('room_bench', 'actor_bench', 'hit')?.streamId !== accepted.streamId) throw new Error('Hit mismatch'); }, samples),
    indexedMissMs: measure(i => { if (commands.findByClientTxn('room_bench', 'actor_bench', `miss:${i}`)) throw new Error('Unexpected hit'); }, samples),
  };
  const json = JSON.stringify(result, null, 2);
  if (values.output) writeFileSync(values.output, json + '\n');
  console.log(json);
} finally { store.close(); rmSync(root, { recursive: true, force: true }); }
