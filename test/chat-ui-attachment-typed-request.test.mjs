import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
import {buildTypedAttachmentRequest} from './src/apps/chat-ui/src/attachments/core-attachment-typed-request.ts';
import {postPreparedAttachmentMessage,postMessage} from './src/apps/chat-ui/src/api-chat-sessions.ts';
import {CoreAttachmentDraftStore} from './src/apps/chat-ui/src/attachments/core-attachment-draft.ts';
import {createMessageContentBinding} from './src/shared/message-content-binding.ts';
import {readAttachmentMessage} from './src/attachments/message.ts';
const pin={type:'example/stick',pluginId:'example',contributionId:'example/stick',revision:'r1',contentHash:'hash'};
const media=[{draftResourceId:'blob',mimeType:'image/png',bytes:3}];
const resource={preparedUploadId:'attres_123',draftResourceId:'blob',mimeType:'image/png',bytes:3,sha256:'a'.repeat(64),name:'test.png',state:'prepared'};
function fixture() {
 const attachments=[{id:'att_note',revision:1,type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}},
 {id:'att_plugin',revision:1,type:'example/stick',schemaVersion:1,payload:{text:'proof'},media}];
 const snapshot={sessionId:'ps_test',clientTxnId:'txn',text:'',frozenAt:'clock',attachments};
 return {snapshot,pins:[pin],resources:[resource],delivery:'queue',webAnnotationIds:['annot'],roomId:'room'};
}
function disk() {const rows=new Map();return {readText:key=>rows.get(key)??null,writeText:(key,value)=>rows.set(key,value),removeText:key=>rows.delete(key)};}
`;
async function scenario(script) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + script],
		{ cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("typed builder captures frozen pins/media with exact server v1 contract and no legacy upload paths", async () => {
	await scenario(`
 const input=fixture(); const body=buildTypedAttachmentRequest(input);
 assert.deepEqual({a:body.attachmentVersion,d:body.admissionVersion,b:body.contentBindingVersion},{a:1,d:2,b:1});
 assert.equal(body.text,''); assert.equal(body.piboSessionId,'ps_test');assert.equal(body.clientTxnId,'txn');
 assert.deepEqual(body.attachmentProviderPins,[pin]); assert.deepEqual(body.attachmentResources,[{draftResourceId:'blob',preparedUploadId:'attres_123'}]);
 assert.equal('fileAttachmentPaths' in body,false); assert.equal(readAttachmentMessage(body).resources.length,1);
 const proof=createMessageContentBinding({sessionId:'ps_test',delivery:'queue',body});assert.equal(proof.sha256.length,64);
 input.snapshot.attachments[1].payload.text='mutated'; input.resources[0].preparedUploadId='attres_other';
 assert.equal(body.attachments[1].payload.text,'proof');assert.equal(body.attachmentResources[0].preparedUploadId,'attres_123');
 `);
});

test("typed builder refuses legacy paths, missing/foreign pins, missing/mismatched/unscoped bytes and malformed body", async () => {
	await scenario(`
 const base=fixture(); const fail=(patch,code)=>assert.throws(()=>buildTypedAttachmentRequest({...base,...patch}),{code});
 fail({fileAttachmentPaths:['/legacy/upload']},'ATT_INVALID_JSON');
 fail({pins:[]},'ATT_PROVIDER_MISSING');fail({pins:[{...pin,type:'other'}]},'ATT_PROVIDER_MISSING');
 fail({pins:[pin,pin]},'ATT_PROVIDER_MISSING');fail({resources:[]},'ATT_INVALID_JSON');
 fail({resources:[{...resource,bytes:9}]},'ATT_BYTES_MISSING');
 fail({resources:[{...resource,state:'accepted'}]},'ATT_BYTES_MISSING');
 fail({resources:[{...resource,preparedUploadId:'not-an-attres-id'}]},'ATT_BYTES_MISSING');
 fail({resources:[{...resource,preparedUploadId:'attres_'}]},'ATT_BYTES_MISSING');
 fail({snapshot:{...base.snapshot,attachments:[]}},'ATT_INVALID_JSON');
 fail({snapshot:{...base.snapshot,clientTxnId:' txn '}},'ATT_INVALID_JSON');
 fail({snapshot:{...base.snapshot,clientTxnId:'a'.repeat(161)}},'ATT_INVALID_JSON');
 fail({snapshot:{...base.snapshot,attachments:[base.snapshot.attachments[0],{...base.snapshot.attachments[1],schemaVersion:0}]}},'ATT_INVALID_JSON');
 fail({roomId:123},'ATT_INVALID_JSON');
 fail({webAnnotationIds:[undefined]},'ATT_INVALID_JSON');
 `);
});

test("typed body is durably prepared before its verbatim POST and unknown/mismatched proof never sends", async () => {
	await scenario(`
 const input=fixture();const state=disk();let next=0;
 const store=new CoreAttachmentDraftStore(state,'ps_test',{now:()=> 'clock',createId:()=> 'att_'+ ++next});
 await store.add({sessionId:'ps_test',type:'pibo.core/note',schemaVersion:1,payload:{text:'note'}});
 await store.add({sessionId:'ps_test',type:'example/stick',schemaVersion:1,payload:{text:'proof'},media});
 const snapshot=store.freezeForSend('txn','');const body=buildTypedAttachmentRequest({...input,snapshot});
 const prepared=store.prepareSubmission(snapshot,body);
 let calls=[];globalThis.fetch=async (url, init)=>{calls.push({url,init});return {ok:true,json:async()=>({receipt:{id:'receipt'}})};};
 const returned=await postPreparedAttachmentMessage(store.getPreparedSubmission('txn'));assert.equal(returned.receipt.id,'receipt');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/chat/message');assert.deepEqual(JSON.parse(calls[0].init.body),prepared.body);
 const wrong=structuredClone(prepared);wrong.body.attachments[0].payload.text='tampered';
 await assert.rejects(postPreparedAttachmentMessage(wrong),{code:'ATT_ACCEPTANCE_UNKNOWN'});assert.equal(calls.length,1);
 const legacy=structuredClone(prepared);legacy.body.fileAttachmentPaths=[];
 await assert.rejects(postPreparedAttachmentMessage(legacy),{code:'ATT_ACCEPTANCE_UNKNOWN'});assert.equal(calls.length,1);
 const stale={...prepared,contentBinding:{version:1,sha256:'0'.repeat(64)}};
 await assert.rejects(postPreparedAttachmentMessage(stale),{code:'ATT_ACCEPTANCE_UNKNOWN'});assert.equal(calls.length,1);
 await assert.rejects(postPreparedAttachmentMessage(null),{code:'ATT_ACCEPTANCE_UNKNOWN'});assert.equal(calls.length,1);
 `);
});

test("typed transport preserves known rejection and unknown receipt behavior without consuming local draft", async () => {
	await scenario(`
 const input=fixture();const body=buildTypedAttachmentRequest(input);
 const prepared={body,contentBinding:createMessageContentBinding({sessionId:'ps_test',delivery:'queue',body})};
 let calls=[];globalThis.fetch=async (url,init)=>{calls.push({url,init});return {ok:false,status:409,json:async()=>({error:'conflict'})};};
 await assert.rejects(postPreparedAttachmentMessage(prepared),error=>error.status===409);
 assert.equal(calls.length,1);
 globalThis.fetch=async ()=>{throw new Error('offline')};
 await assert.rejects(postPreparedAttachmentMessage(prepared),error=>error.acceptanceUnknown===true);
 globalThis.fetch=async ()=>({ok:true,json:async()=>({receipt:null})});
 await assert.rejects(postPreparedAttachmentMessage(prepared),error=>error.acceptanceUnknown===true);
 `);
});

test("legacy postMessage keeps text, path and delivery body unchanged when typed transport is present", async () => {
	await scenario(`
 let body;globalThis.fetch=async (_,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({receipt:{id:'legacy'}})}};
 await postMessage('ps_test','plain','legacy-txn','room',['annot'],['/legacy/path'],'steer');
 assert.deepEqual(body,{admissionVersion:2,piboSessionId:'ps_test',text:'plain',clientTxnId:'legacy-txn',delivery:'steer',roomId:'room',webAnnotationIds:['annot'],fileAttachmentPaths:['/legacy/path']});
 `);
});
