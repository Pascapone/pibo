import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
const {CoreAttachmentDraftStore} = await import('./src/apps/chat-ui/src/attachments/core-attachment-draft.ts');
const {transitionCoreAttachmentDraft: transition, readCoreAttachmentDraft: read} = await import('./src/apps/chat-ui/src/attachments/core-attachment-transitions.ts');
const {createMemoryAttachmentStores,createLocalStorageDraftTextStorage,deleteUnheldBlobs} = await import('./src/apps/chat-ui/src/attachments/core-attachment-persistence.ts');
const {rebaseCopyMedia, readCopyBufferState} = await import('./src/apps/chat-ui/src/attachments/core-attachment-copy-state.ts');
const input = {sessionId:'ps_test',type:'pibo.core/note',schemaVersion:1,payload:{text:'original'}};
const options = {createId:()=> 'att_fixed',now:()=> 'clock'};
function memory() { let raw=null; return {readText:()=>raw,writeText:(_key,text)=>{raw=text},removeText:()=>{raw=null},raw:()=>raw}; }
`;
async function scenario(body) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + body], { cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("synchronous commands preserve public Promise rejection and add/update/remove behavior", async () => {
	await scenario(`
const a = new CoreAttachmentDraftStore(memory(),'ps_test',options);
const b = new CoreAttachmentDraftStore(memory(),'ps_test',options);
const direct = a.executeCommand({kind:'add',input});
assert.equal(direct,'att_fixed'); assert.equal(direct?.then,undefined);
assert.equal(await b.add(input), direct);
assert.deepEqual(a.view(),b.view());
a.executeCommand({kind:'update',id:direct,expectedRevision:1,next:{payload:{text:'edited'}}});
await b.update(direct,1,{payload:{text:'edited'}}); assert.deepEqual(a.view(),b.view());
assert.throws(()=>a.executeCommand({kind:'update',id:direct,expectedRevision:1,next:{}}),{code:'ATT_STALE_REVISION'});
let rejected; assert.doesNotThrow(()=>{rejected=b.update(direct,1,{})}); await assert.rejects(rejected,{code:'ATT_STALE_REVISION'});
assert.throws(()=>a.executeCommand({kind:'add',input:null}),{code:'ATT_INVALID_JSON'});
assert.doesNotThrow(()=>{rejected=b.add(null)}); await assert.rejects(rejected,{code:'ATT_INVALID_JSON'});
a.executeCommand({kind:'remove',id:direct}); await b.remove(direct); assert.deepEqual(a.view(),b.view());
assert.throws(()=>a.executeCommand(null),{code:'ATT_INVALID_JSON'});
assert.throws(()=>a.executeCommand({kind:'unknown'}),{code:'ATT_INVALID_JSON'});
`);
});

test("transaction-local transitions capture the engine serializer and never replace corrupt text", async () => {
	await scenario(`
const source = structuredClone(input);
const added = transition(null,'ps_test',{kind:'add',input:source},options);
source.payload.text='caller change'; added.view.records[0].payload.text='view change';
assert.equal(read(added.text,'ps_test').records[0].payload.text,'original');
assert.throws(()=>transition('{broken','ps_test',{kind:'add',input},options),{code:'ATT_STORAGE_FAILED'});
assert.throws(()=>transition(added.text,'ps_foreign',{kind:'remove',id:added.result}),{code:'ATT_STORAGE_FAILED'});
const noChange=transition(added.text,'ps_test',{kind:'remove',id:'missing'});
assert.equal(noChange.text,added.text);
const unchanged=added.text;
assert.throws(()=>transition(added.text,'ps_test',{kind:'update',id:added.result,expectedRevision:99,next:{payload:{}}}),{code:'ATT_STALE_REVISION'});
assert.equal(added.text,unchanged);
`);
});

test("detached read views preserve frozen retry bodies and consume only frozen revisions", async () => {
	await scenario(`
let state=transition(null,'ps_test',{kind:'add',input},options);
const id=state.result;
state=transition(state.text,'ps_test',{kind:'freeze',clientTxnId:'txn',text:'message'},options);
const snapshot=state.result;
const body={admissionVersion:2,contentBindingVersion:1,piboSessionId:'ps_test',clientTxnId:'txn',text:snapshot.text,attachments:snapshot.attachments};
state=transition(state.text,'ps_test',{kind:'prepare',snapshot,body});
const proof=state.result.contentBinding;
const mutated=read(state.text,'ps_test'); mutated.openSnapshots[0].attachments[0].payload.text='changed'; mutated.preparedSubmissions.txn.body.text='changed';
assert.equal(read(state.text,'ps_test').preparedSubmissions.txn.body.text,'message');
assert.deepEqual(read(state.text,'ps_test').preparedSubmissions.txn.contentBinding,proof);
state=transition(state.text,'ps_test',{kind:'update',id,expectedRevision:1,next:{payload:{text:'newer'}}},options);
state=transition(state.text,'ps_test',{kind:'accept',snapshot,receipt:{clientTxnId:'txn',accepted:true}});
assert.deepEqual(state.result,{consumed:[],duplicate:false});
assert.equal(state.view.records[0].payload.text,'newer'); assert.deepEqual(state.view.openSnapshots,[]);
assert.equal(state.view.preparedSubmissions.txn,undefined); assert.deepEqual(state.view.acceptedTransactions,['txn']);
const duplicate=transition(state.text,'ps_test',{kind:'accept',snapshot,receipt:{clientTxnId:'txn',accepted:true}});
assert.deepEqual(duplicate.result,{consumed:[],duplicate:true}); assert.equal(duplicate.text,state.text);
`);
});

test("provider-pinned update rejects same-revision id reissue under a different type or schema", async () => {
	await scenario(`
let state=transition(null,'ps_test',{kind:'add',input},options);
const id=state.result;
state=transition(state.text,'ps_test',{kind:'remove',id});
state=transition(state.text,'ps_test',{kind:'add',input:{...input,type:'example/other',schemaVersion:2,payload:{value:1}}},options);
assert.equal(state.result,id,'the pilot permits reissue after removal');
const unchanged=state.text;
assert.throws(()=>transition(state.text,'ps_test',{kind:'update',id,expectedRevision:1,expectedType:'pibo.core/note',expectedSchemaVersion:1,next:{payload:{text:'wrong type'}}}),{code:'ATT_STALE_REVISION'});
assert.throws(()=>transition(state.text,'ps_test',{kind:'update',id,expectedRevision:1,expectedType:'example/other',expectedSchemaVersion:1,next:{payload:{text:'wrong schema'}}}),{code:'ATT_STALE_REVISION'});
assert.equal(state.text,unchanged);
const accepted=transition(state.text,'ps_test',{kind:'update',id,expectedRevision:1,expectedType:'example/other',expectedSchemaVersion:2,next:{payload:{value:2}}});
assert.equal(accepted.view.records[0].payload.value,2);
`);
});

test("memory byte seam is immutable and detached without claiming IndexedDB durability", async () => {
	await scenario(`
const {blobs,copy}=createMemoryAttachmentStores('owner');
const bytes=new Uint8Array([1,2,3]);
await blobs.putBlob({sessionId:'ps_test',draftId:'att',mimeType:'image/png',data:bytes,blobId:'blob'});
bytes[0]=9; const loaded=await blobs.getBlob('blob'); loaded.data[0]=8;
assert.deepEqual([...(await blobs.getBlob('blob')).data],[1,2,3]);
await assert.rejects(blobs.putBlob({sessionId:'ps_other',draftId:'att',mimeType:'image/png',data:bytes,blobId:'blob'}),{code:'ATT_STALE_REVISION'});
const entry={copyId:'copy',sourceSessionId:'ps_test',sourceDraftId:'att',sourceRevision:1,type:'pibo.core/file',schemaVersion:1,payload:{value:1},media:[{draftResourceId:'blob',mimeType:'image/png',bytes:3}]};
const staged=await copy.stage(0,entry); entry.payload.value=9; const copied=await copy.load(); copied.entry.payload.value=8;
assert.equal((await copy.load()).entry.payload.value,1); assert.equal(staged.revision,1);
const independent=staged.entry.media[0].draftResourceId; assert.notEqual(independent,'blob');
assert.deepEqual([...(await blobs.getBlob(independent)).data],[1,2,3]);
await assert.rejects(copy.stage(0,entry),{code:'ATT_STALE_REVISION'});
const result=await deleteUnheldBlobs(blobs,['missing','blob'],new Set(['blob']));
assert.deepEqual(result,{deleted:[],keptHeld:['blob']});
await blobs.deleteBlob('blob'); assert.deepEqual([...(await blobs.getBlob(independent)).data],[1,2,3]);
const cleared=await copy.clear(1); assert.equal(cleared.revision,2); assert.equal(await blobs.getBlob(independent),undefined);
await assert.rejects(copy.stage(0,{...entry,media:[]}),{code:'ATT_STALE_REVISION'});
`);
});

test("copy byte ids fail closed on collisions and legacy structured values do not gain typed authority", async () => {
	await scenario(`
assert.throws(()=>rebaseCopyMedia([{draftResourceId:'source',mimeType:'image/png',bytes:1}],()=> 'source'),{code:'ATT_STALE_REVISION'});
const legacy={ownerUserId:'owner',copyId:'old',sourceSessionId:'ps_test',sourceDraftId:'att',sourceRevision:1,stagedAt:'clock',
  payload:new Uint8Array([1,2]),media:[{draftResourceId:'source',mimeType:'image/png',bytes:1},{draftResourceId:'source',mimeType:'image/png',bytes:1}]};
const loaded=readCopyBufferState(legacy,'owner'); assert.equal(loaded.revision,1); assert.deepEqual(loaded.legacy,legacy);
assert.equal(loaded.entry,undefined);
assert.throws(()=>readCopyBufferState(legacy,'foreign'),{code:'ATT_STORAGE_FAILED'});
`);
});

test("legacy synchronous adapter never falls back to unowned content on login", async () => {
	await scenario(`
const entries=new Map([['key','unowned']]);
globalThis.localStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key),key:index=>[...entries.keys()][index]??null,get length(){return entries.size}};
const a=createLocalStorageDraftTextStorage('a'); const b=createLocalStorageDraftTextStorage('b');
assert.equal(a.readText('key'),null); assert.equal(b.readText('key'),null); assert.equal(entries.get('key'),'unowned');
a.writeText('key','owned'); assert.equal(a.readText('key'),'owned'); assert.equal(b.readText('key'),null);
a.removeText('key'); assert.equal(entries.get('key'),'unowned'); assert.equal(a.readText('key'),null);
`);
});
