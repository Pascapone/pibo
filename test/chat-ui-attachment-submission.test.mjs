import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
const { CoreAttachmentDraftStore } = await import('./src/apps/chat-ui/src/attachments/core-attachment-draft.ts');
const { reconcileAcceptance } = await import('./src/apps/chat-ui/src/attachments/core-attachment-receipts.ts');
function storage() {
 const entries = new Map(); return { entries, fail: false, writes: 0,
 readText(key) { return entries.get(key) ?? null; },
 writeText(key, value) { if(this.fail) throw new Error('quota'); entries.set(key, value); this.writes++; },
 removeText(key) { entries.delete(key); } };
}
async function fixture() {
 const disk = storage(); let next = 0;
 const make = () => new CoreAttachmentDraftStore(disk, 'ps_test', { now: () => 'clock', createId: () => 'a' + ++next });
 const store = make(); const id = await store.add({ sessionId: 'ps_test', type: 'pibo.core/note', schemaVersion: 1, payload: { text: 'frozen' } });
 const snapshot = store.freezeForSend('txn', 'message');
 const body = { admissionVersion: 2, contentBindingVersion: 1, piboSessionId: 'ps_test', clientTxnId: 'txn', text: snapshot.text, attachments: snapshot.attachments, delivery: 'queue' };
 return { disk, make, store, id, snapshot, body };
}
function receipt(snapshot, contentBinding, state = 'accepted') { return { id: 'receipt', sessionId: snapshot.sessionId, eventId: snapshot.clientTxnId, streamId: 1, state, contentBinding }; }
function reconcile(store, snapshot, value, extra = {}) { return reconcileAcceptance({ store, snapshot, query: { async findByClientTxnId() { return value; } }, providerScope: { sessionId: 'ps_test' }, ...extra }); }
`;
async function scenario(script) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + script], { cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("prepared wire body is persisted before send, immutable across reload and storage-failure atomic", async () => {
	await scenario(`
 const f = await fixture(); const before = [...f.disk.entries];
 f.disk.fail = true;
 assert.throws(() => f.store.prepareSubmission(f.snapshot, f.body), { code: 'ATT_STORAGE_FAILED' });
 assert.equal(f.store.getPreparedSubmission('txn'), undefined); assert.deepEqual([...f.disk.entries], before);
 f.disk.fail = false;
 const prepared = f.store.prepareSubmission(f.snapshot, f.body); const writes = f.disk.writes;
 assert.deepEqual(f.store.prepareSubmission(f.snapshot, f.body), prepared); assert.equal(f.disk.writes, writes);
 f.body.attachments[0].payload.text = 'caller mutation'; prepared.body.text = 'returned mutation';
 const restored = f.make(); const stable = restored.getPreparedSubmission('txn');
 assert.equal(stable.body.text, 'message'); assert.equal(stable.body.attachments[0].payload.text, 'frozen');
 for(const change of [body => body.delivery = 'steer', body => body.uploads = [{ path: 'different' }], body => body.extra = true]) {
  const changed = structuredClone(stable.body); change(changed);
  const snap = restored.freezeForSend('txn', 'message');
  assert.throws(() => restored.prepareSubmission(snap, changed), { code: 'ATT_ACCEPTANCE_UNKNOWN' });
 }
 assert.throws(() => restored.setPreparedUploads('txn', [{blobId:'blob',path:'uploads/other',bytes:3,mimeType:'text/plain'}]), {code:'ATT_ACCEPTANCE_UNKNOWN'});
 assert.deepEqual(restored.getPreparedUploads('txn'), []);
 assert.equal(f.disk.writes, writes, 'rejected replacements never persist');
 `);
});

test("a matched receipt ID or echoed fingerprint cannot consume missing or different local content", async () => {
	await scenario(`
 const f = await fixture();
 const weak = { ...receipt(f.snapshot, undefined), fingerprint: 'echoed' };
 await assert.rejects(reconcile(f.store, f.snapshot, weak, { expectedFingerprint: 'echoed' }), { code: 'ATT_ACCEPTANCE_UNKNOWN' });
 const prepared = f.store.prepareSubmission(f.snapshot, f.body);
 for(const value of [weak, receipt(f.snapshot, {version:1,sha256:'a'.repeat(64)}), undefined, {...receipt(f.snapshot,prepared.contentBinding),eventId:'older'}, {...receipt(f.snapshot,prepared.contentBinding),sessionId:'foreign'}, receipt(f.snapshot,prepared.contentBinding,'rejected'), receipt(f.snapshot,prepared.contentBinding,'future-state'), {...receipt(f.snapshot,prepared.contentBinding),id:''}, {...receipt(f.snapshot,prepared.contentBinding),streamId:0}]) {
  await assert.rejects(reconcile(f.store, f.snapshot, value, { expectedFingerprint: 'echoed' }), { code: 'ATT_ACCEPTANCE_UNKNOWN' });
  assert.equal(f.store.list().length, 1); assert.ok(f.store.getPreparedSubmission('txn'));
 }
 // Another writer's legitimate receipt for this transaction but a different
 // frozen payload remains a mismatch after loss of its409 response/reload.
 const changed = structuredClone(f.body); changed.attachments[0].payload.text = 'other writer';
 const {createMessageContentBinding} = await import('./src/shared/message-content-binding.ts');
 const foreignProof = createMessageContentBinding({sessionId:'ps_test',delivery:'queue',body:changed});
 await assert.rejects(reconcile(f.make(), f.snapshot, receipt(f.snapshot, foreignProof)), {code:'ATT_ACCEPTANCE_UNKNOWN'});
 assert.equal(f.make().list().length, 1);
 `);
});

test("all admitted command states consume matching revisions once, independently of model outcome", async () => {
	await scenario(`
 for(const state of ['accepted','waiting_slot','initializing','session_queue','running','completed','failed','interrupted']) {
  const f = await fixture(); const prepared = f.store.prepareSubmission(f.snapshot, f.body);
  let notifications = 0; const extra = {providerLookup: () => ({notifyAccepted() {notifications++;}})};
  const value = receipt(f.snapshot, prepared.contentBinding, state);
  const result = await reconcile(f.make(), f.snapshot, value, extra);
  assert.deepEqual(result.consumed, [f.id]); assert.equal(result.weakBinding, false); assert.equal(notifications, 1);
  const duplicate = await reconcile(f.make(), f.snapshot, value, extra);
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.weakBinding, true, 'local duplicate does not pretend to re-prove an old receipt');
  assert.equal(notifications, 1); assert.equal(f.make().getPreparedSubmission('txn'), undefined);
 }
 const f = await fixture(); const prepared = f.store.prepareSubmission(f.snapshot, f.body);
 await f.store.update(f.id, 1, {payload:{text:'newer live revision'}});
 const result = await reconcile(f.store, f.snapshot, receipt(f.snapshot,prepared.contentBinding));
 assert.deepEqual(result.consumed, []); assert.equal(f.store.get(f.id).payload.text, 'newer live revision');
 `);
});

test("submission must contain the bound snapshot and corrupted persisted proofs fail closed", async () => {
	await scenario(`
 const f = await fixture();
 for(const changes of [{clientTxnId:'other'}, {piboSessionId:'foreign'}, {text:'different'}, {attachments:[]}, {delivery:null}, {contentBindingVersion:2}]) {
  assert.throws(() => f.store.prepareSubmission(f.snapshot, {...f.body,...changes}));
  assert.equal(f.store.getPreparedSubmission('txn'), undefined);
 }
 const forged = structuredClone(f.snapshot); forged.attachments[0].payload.text = 'forged';
 assert.throws(() => f.store.prepareSubmission(forged, {...f.body, attachments:forged.attachments}), {code:'ATT_ACCEPTANCE_UNKNOWN'});
 f.store.prepareSubmission(f.snapshot, f.body);
 const key = [...f.disk.entries.keys()][0]; const saved = JSON.parse(f.disk.entries.get(key));
 saved.preparedSubmissions.txn.contentBinding.sha256 = '0'.repeat(64);
 f.disk.entries.set(key, JSON.stringify(saved)); const badBytes = f.disk.entries.get(key);
 const restored = f.make(); assert.equal(restored.storageError.code,'ATT_STORAGE_FAILED');
 assert.equal(restored.getPreparedSubmission('txn'),undefined); assert.equal(f.disk.entries.get(key),badBytes,'corruption is not silently rewritten');
 `);
});
