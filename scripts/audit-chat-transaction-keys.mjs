import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { chatClientTransactionKey } from '../dist/apps/chat/data/event-command-service.js';

const { values } = parseArgs({ options: { help: { type: 'boolean' }, snapshot: { type: 'string' }, 'batch-size': { type: 'string', default: '500' } } });
if (values.help || !values.snapshot) {
  console.log('Audit client transaction keys across all rooms of a private, consistent SQLite snapshot.\nUsage: node scripts/audit-chat-transaction-keys.mjs --snapshot <path> [--batch-size 500]\nRead-only; no schema initialization, updates or payload output. Nonempty mismatches exit 2 and block indexed rollout until an explicit compatibility/backfill decision.');
  process.exit(values.help ? 0 : 1);
}
const batch = Number(values['batch-size']);
if (!Number.isSafeInteger(batch) || batch < 1 || batch > 1000) throw new Error('Batch size must be 1..1000');
const db = new DatabaseSync(values.snapshot, { readOnly: true });
const result = { scanned: 0, accepted: 0, withClientTxn: 0, emptyClientTxn: 0, missingScope: 0, canonical: 0, noncanonical: 0, lastStreamId: 0 };
try {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100');
  const query = db.prepare('SELECT stream_id, room_id, actor_id, type, idempotency_key, attributes_json FROM event_log WHERE stream_id > ? ORDER BY stream_id LIMIT ?');
  while (true) {
    const rows = query.all(result.lastStreamId, batch);
    if (!rows.length) break;
    for (const row of rows) {
      result.scanned++;
      result.lastStreamId = row.stream_id;
      if (row.type === 'user.message.accepted') result.accepted++;
      const attributes = JSON.parse(row.attributes_json);
      if (typeof attributes.clientTxnId !== 'string') continue;
      result.withClientTxn++;
      if (!attributes.clientTxnId) { result.emptyClientTxn++; continue; }
      if (!row.room_id || !row.actor_id) result.missingScope++;
      if (row.idempotency_key === chatClientTransactionKey(row.room_id, row.actor_id, attributes.clientTxnId)) result.canonical++;
      else result.noncanonical++;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(JSON.stringify({ ...result, compatible: result.noncanonical === 0 }, null, 2));
  if (result.noncanonical) process.exitCode = 2;
} finally { db.close(); }
