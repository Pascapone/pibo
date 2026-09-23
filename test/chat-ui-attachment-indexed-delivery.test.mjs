import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
import {prepareTypedIndexedSubmission} from './src/apps/chat-ui/src/attachments/core-attachment-prepare-client.ts';
import {deliverTypedIndexedAttachments} from './src/apps/chat-ui/src/attachments/core-attachment-delivery-client.ts';
import {reconcileIndexedAcceptance} from './src/apps/chat-ui/src/attachments/core-attachment-receipts.ts';
import {readCoreAttachmentDraft,transitionCoreAttachmentDraft} from './src/apps/chat-ui/src/attachments/core-attachment-transitions.ts';
import {coreNoteProvider} from './src/attachments/core-providers.ts';
import {MAX_WEB_REQUEST_BODY_BYTES} from './src/shared/web-body-limit.ts';
const sessionId='ps_test',scope={sessionId};
const lookup=(type,selected)=>selected.sessionId===sessionId&&type==='pibo.core/note'?coreNoteProvider:undefined;
function indexed() {
 let text=null,revision=0,mutations=[];
 const facade={sessionId,mutations,
  async load(){return {revision,view:readCoreAttachmentDraft(text,sessionId)}},
  async execute(expected,command){if(expected!==revision)throw Object.assign(new Error('stale'),{code:'ATT_STALE_REVISION'});
   const updated=transitionCoreAttachmentDraft(text,sessionId,command);
   if(updated.text!==text){text=updated.text;revision++;}mutations.push(command.kind);
   return {result:updated.result,current:{revision,view:updated.view}};
  },raw:()=>text};
 return facade;
}
async function prepared(draft=indexed(),extra={}){
 const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 const input={draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue',stageResources:async()=>[],...extra};
 return {draft,input,result:await prepareTypedIndexedSubmission(input)};
}
function receipt(result,state='accepted',binding=result.prepared.contentBinding){return {id:'receipt',sessionId,eventId:'txn',streamId:1,state,contentBinding:binding};}
`;
async function scenario(script) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + script],
		{ cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("data-only indexed adapter prepares immutable typed body before any POST and reuses it on unchanged retry", async () => {
	await scenario(`
 let stages=0;const draft=indexed(); const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 const input={draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue',roomId:'room',webAnnotationIds:['annotation'],stageResources:async()=>{stages++;return []}};
 const first=await prepareTypedIndexedSubmission(input);assert.equal(first.reused,false);assert.equal(stages,1);
 assert.equal(first.prepared.body.attachmentVersion,1);assert.equal(first.prepared.body.text,'');
 assert.deepEqual(first.prepared.body.attachmentProviderPins,[]);assert.deepEqual(first.prepared.body.attachmentResources,[]);
 assert.deepEqual(draft.mutations,['add','freeze','prepare']);
 first.prepared.body.text='caller mutation';
 const retry=await prepareTypedIndexedSubmission({...input,expectedRevision:0});
 assert.equal(retry.reused,true);assert.equal(stages,1);assert.equal(retry.prepared.body.text,'');
 assert.equal(retry.prepared.contentBinding.sha256.length,64);
 assert.deepEqual(draft.mutations,['add','freeze','prepare']);
 `);
});

test("a prepared transaction cannot be silently replaced by new text, delivery, annotations or room", async () => {
	await scenario(`
 const {draft,input,result}=await prepared(undefined,{roomId:'room',webAnnotationIds:['annotation']});
 const before=draft.raw();
 for(const patch of [{text:'new'},{delivery:'steer'},{roomId:'other'},{webAnnotationIds:['different']}]) {
  await assert.rejects(prepareTypedIndexedSubmission({...input,...patch}),{code:'ATT_ACCEPTANCE_UNKNOWN'});
  assert.equal(draft.raw(),before);
 }
 assert.equal(result.prepared.body.text,'');
 `);
});

test("invalid typed metadata fails before staging and prototype-named transactions remain exact own keys", async () => {
 await scenario(`
 const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 let stages=0;const base={draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'toString',text:'',delivery:'queue',stageResources:async()=>{stages++;return []}};
 for(const patch of [{delivery:'unknown'},{roomId:123},{webAnnotationIds:[null]},{fileAttachmentPaths:['/legacy']}]) {
  await assert.rejects(prepareTypedIndexedSubmission({...base,...patch}),{code:'ATT_INVALID_JSON'});
 }
 assert.equal(stages,0);assert.equal((await draft.load()).view.openSnapshots.length,0);
 const first=await prepareTypedIndexedSubmission(base);assert.equal(first.prepared.body.clientTxnId,'toString');assert.equal(stages,1);
 assert.equal((await prepareTypedIndexedSubmission({...base,expectedRevision:0})).reused,true);
 const accepted=await reconcileIndexedAcceptance({draft,snapshot:first.snapshot,providerScope:scope,query:{async findByClientTxnId(){return {...receipt(first),eventId:'toString'}}}});
 assert.equal(accepted.consumed.length,1);
 `);
});

test("untransportable bytes and noncanonical MIME fail before any snapshot or provider callback", async () => {
 await scenario(`
 for(const mimeType of ['image/png','IMAGE/PNG','image/png; charset=UTF-8']){
  const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/image',schemaVersion:1,payload:{alt:'test'},media:[{draftResourceId:'b',mimeType,bytes:MAX_WEB_REQUEST_BODY_BYTES}]}});
  let stages=0;await assert.rejects(prepareTypedIndexedSubmission({draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue',stageResources:async()=>{stages++;return []}}),{code:'ATT_LIMIT_EXCEEDED'});
  assert.equal(stages,0);assert.equal((await draft.load()).view.openSnapshots.length,0);
 }
 const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/image',schemaVersion:1,payload:{alt:'test'},media:[{draftResourceId:'b',mimeType:'IMAGE/PNG',bytes:1}]}});
 await assert.rejects(prepareTypedIndexedSubmission({draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue',stageResources:async()=>[]}),{code:'ATT_INVALID_JSON'});
 assert.equal((await draft.load()).view.openSnapshots.length,0);
 `);
});

test("failed staging retains an open frozen snapshot, retrying same txn without replacing it", async () => {
	await scenario(`
 const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 const input={draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue'};
 await assert.rejects(prepareTypedIndexedSubmission({...input,stageResources:async()=>{throw Object.assign(new Error('network'),{code:'ATT_STORAGE_FAILED'})}}),{code:'ATT_STORAGE_FAILED'});
 const mid=await draft.load();assert.equal(mid.view.openSnapshots.length,1);assert.equal(mid.view.preparedSubmissions.txn,undefined);
 const next=await prepareTypedIndexedSubmission({...input,expectedRevision:mid.revision,stageResources:async()=>[]});
 assert.equal(next.reused,false);assert.equal(next.snapshot.frozenAt,mid.view.openSnapshots[0].frozenAt);assert.ok((await draft.load()).view.preparedSubmissions.txn);
 `);
});

test("CAS conflict during staging retains original and a later retry prepares the bound snapshot despite live edits", async () => {
	await scenario(`
 const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 const input={draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,clientTxnId:'txn',text:'',delivery:'queue',stageResources:async()=>{
  const row=await draft.load();await draft.execute(row.revision,{kind:'update',id:added.result,expectedRevision:1,next:{payload:{text:'edited'}}});return [];
 }};
 await assert.rejects(prepareTypedIndexedSubmission(input),{code:'ATT_STALE_REVISION'});
 const after=await draft.load();assert.equal(after.view.preparedSubmissions.txn,undefined);assert.equal(after.view.records[0].payload.text,'edited');assert.equal(after.view.openSnapshots.length,1);
 const recovered=await prepareTypedIndexedSubmission({...input,expectedRevision:after.revision,stageResources:async()=>[]});
 assert.equal(recovered.snapshot.attachments[0].payload.text,'note');assert.equal(recovered.prepared.body.attachments[0].payload.text,'note');
 assert.equal((await draft.load()).view.records[0].payload.text,'edited');
 `);
});

test("indexed receipt reconciliation accepts only independently matched durable receipts, then CAS-consumes once", async () => {
	await scenario(`
 const {draft,result}=await prepared();let notices=0;
 const wrong={version:1,sha256:'0'.repeat(64)};
 await assert.rejects(reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,providerLookup:lookup,query:{async findByClientTxnId(){return receipt(result,'accepted',wrong)}}}),{code:'ATT_ACCEPTANCE_UNKNOWN'});
 assert.equal((await draft.load()).view.records.length,1);
 const good=await reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,
  providerLookup:(type,selected)=>({...lookup(type,selected),notifyAccepted(){notices++}}),
  query:{async findByClientTxnId(){return receipt(result,'failed')}}});
 assert.equal(good.weakBinding,false);assert.equal(good.receiptId,'receipt');assert.equal(good.consumed.length,1);assert.equal(notices,1);
 const state=await draft.load();assert.equal(state.view.records.length,0);assert.equal(state.view.openSnapshots.length,0);
 const duplicate=await reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,query:{async findByClientTxnId(){throw Error('no duplicate lookup')}}});
 assert.equal(duplicate.duplicate,true);assert.equal(duplicate.weakBinding,true);assert.equal(notices,1);
 `);
});

test("fresh typed send posts only the re-read immutable body and consumes from independent receipt", async () => {
 await scenario(`
 const draft=indexed();const added=await draft.execute(0,{kind:'add',input:{sessionId,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}}});
 let stages=0,posts=0;
 const sent=await deliverTypedIndexedAttachments({draft,expectedRevision:added.current.revision,lookup,scope,getPin:()=>undefined,
  clientTxnId:'txn',text:'',delivery:'queue',stageResources:async()=>{stages++;return []},
  postPrepared:async body=>{posts++;assert.deepEqual(body,(await draft.load()).view.preparedSubmissions.txn);
   assert.equal(body.body.attachments[0].payload.text,'note');return {receipt:{id:'echo-must-not-prove'}}},
  query:{async findByClientTxnId(){return {id:'receipt',sessionId,eventId:'txn',streamId:1,state:'running',contentBinding:(await draft.load()).view.preparedSubmissions.txn.contentBinding}}}});
 assert.equal(stages,1);assert.equal(posts,1);assert.equal(sent.consumed.length,1);
 assert.equal((await draft.load()).view.records.length,0);
 `);
});

test("unchanged retry queries admission first, even after provider drift; absent proof retains original", async () => {
 await scenario(`
 const a=await prepared();let posts=0;
 const recovered=await deliverTypedIndexedAttachments({...a.input,expectedRevision:0,lookup:()=>undefined,
  postPrepared:async()=>{posts++;throw Error('must not POST an accepted retry')},query:{async findByClientTxnId(){return receipt(a.result)}}});
 assert.equal(posts,0);assert.equal(recovered.consumed.length,1);
 const b=await prepared();let stages=0,receipts=0;
 const unknown=Object.assign(new Error('lost response'),{acceptanceUnknown:true});
 const base={...b.input,expectedRevision:0,stageResources:async()=>{stages++;return []},
  query:{async findByClientTxnId(){receipts++;return receipts<=2?undefined:receipt(b.result)}}};
 await assert.rejects(deliverTypedIndexedAttachments({...base,postPrepared:async()=>{posts++;throw unknown}}),e=>e===unknown);
 assert.equal((await b.draft.load()).view.records.length,1);
 const retry=await deliverTypedIndexedAttachments({...base,postPrepared:async()=>{posts++;throw Error('must not duplicate') }});
 assert.equal(retry.consumed.length,1);assert.equal(stages,0);assert.equal(posts,1);
 `);
});

test("provider notice failures after durable acceptance are reported, never reclassified as unknown", async () => {
 await scenario(`
 const {draft,result}=await prepared();
 const accepted=await reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,
  providerLookup:()=>({notifyAccepted(){throw Error('plugin unloaded')}}),query:{async findByClientTxnId(){return receipt(result)}}});
 assert.equal(accepted.consumed.length,1);assert.equal(accepted.receiptId,'receipt');assert.deepEqual(accepted.notificationErrors,[{id:result.snapshot.attachments[0].id,message:'plugin unloaded'}]);
 assert.equal((await draft.load()).view.acceptedTransactions.includes('txn'),true);
 const duplicate=await reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,query:{async findByClientTxnId(){throw Error('should not query')}}});
 assert.equal(duplicate.duplicate,true);
 `);
});

test("receipt transport failure and cross-tab revision race preserve the frozen transaction", async () => {
	await scenario(`
 const {draft,result}=await prepared();
 const {receiptTransportFailed}=await import('./src/apps/chat-ui/src/attachments/core-attachment-receipts.ts');
 await assert.rejects(reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,query:{async findByClientTxnId(){throw receiptTransportFailed('offline')}}}),{code:'ATT_ACCEPTANCE_UNKNOWN'});
 await assert.rejects(reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:{sessionId:'other'},query:{async findByClientTxnId(){return receipt(result)}}}),{code:'ATT_ACCESS_DENIED'});
 const current=await draft.load();
 await assert.rejects(reconcileIndexedAcceptance({draft,snapshot:result.snapshot,providerScope:scope,query:{async findByClientTxnId(){
  await draft.execute(current.revision,{kind:'update',id:result.snapshot.attachments[0].id,expectedRevision:1,next:{payload:{text:'newer'}}});return receipt(result)
 }}}),{code:'ATT_STALE_REVISION'});
 assert.equal((await draft.load()).view.records[0].payload.text,'newer');assert.equal((await draft.load()).view.openSnapshots.length,1);
 `);
});
