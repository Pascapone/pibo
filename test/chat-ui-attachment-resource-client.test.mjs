import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
import {stageFrozenAttachmentResources} from './src/apps/chat-ui/src/attachments/core-attachment-resource-client.ts';
import {MAX_WEB_REQUEST_BODY_BYTES} from './src/shared/web-body-limit.ts';
import {MAX_WEB_REQUEST_BODY_BYTES as serverBound} from './src/web/http.ts';
const bytes=new Uint8Array([1,2,3]);
const part={draftResourceId:'blob',mimeType:'image/png',bytes:3};
const snapshot={sessionId:'ps_test',clientTxnId:'txn',text:'frozen',frozenAt:'clock',attachments:[{id:'record',revision:1,type:'pibo.core/image',schemaVersion:1,payload:{alt:'image'},media:[part]}]};
function draft() {const reads=[];return {sessionId:'ps_test',reads,async readFrozenMedia(...scope){reads.push(scope);return {mimeType:'image/png',data:new Uint8Array(bytes)}}};}
function hex(value){return [...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function responseFor(request, overrides={}){
 const form=await request.clone().formData();const file=form.get('file');
 const sha256=hex(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
 return Response.json({attachmentVersion:1,resource:{preparedUploadId:'attres_123',draftResourceId:form.get('draftResourceId'),mimeType:file.type,bytes:file.size,name:file.name,sha256,state:'prepared',...overrides}},{status:201});
}
`;
async function scenario(script) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + script],
		{ cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("frozen scoped bytes are read before exact 4MiB-bounded multipart staging", async () => {
	await scenario(`
 assert.equal(MAX_WEB_REQUEST_BODY_BYTES,serverBound);let called=0;const owner=draft();
 const staged=await stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async request=>{
  called++;assert.equal(request.url,'http://localhost/api/chat/attachment-resources');
  assert.equal(request.method,'POST');assert.equal(request.headers.get('content-type').startsWith('multipart/form-data;'),true);
  assert.ok((await request.clone().arrayBuffer()).byteLength<=MAX_WEB_REQUEST_BODY_BYTES);
  const form=await request.clone().formData();assert.deepEqual([...form.keys()],['piboSessionId','clientTxnId','draftResourceId','file']);
  assert.deepEqual([form.get('piboSessionId'),form.get('clientTxnId'),form.get('draftResourceId')],['ps_test','txn','blob']);
  assert.deepEqual([...new Uint8Array(await form.get('file').arrayBuffer())],[1,2,3]);
  return responseFor(request);
 }});
 assert.deepEqual(owner.reads,[['txn','record','blob']]);assert.equal(called,1);assert.equal(staged[0].preparedUploadId,'attres_123');
 assert.equal(staged[0].sha256,hex(await crypto.subtle.digest('SHA-256',bytes)));
 `);
});

test("staging freezes the Session/transaction/resource scalars before any asynchronous read", async () => {
	await scenario(`
 const source=structuredClone(snapshot);let release;const pending=new Promise(resolve=>release=resolve);const owner=draft();
 owner.readFrozenMedia=async (...args)=>{owner.reads.push(args);return pending};
 const send=stageFrozenAttachmentResources({draft:owner,snapshot:source,fetchImpl:async request=>{
  const form=await request.clone().formData();assert.equal(form.get('piboSessionId'),'ps_test');assert.equal(form.get('clientTxnId'),'txn');assert.equal(form.get('draftResourceId'),'blob');return responseFor(request);
 }});
 source.sessionId='ps_other';source.clientTxnId='other';source.attachments[0].id='changed';source.attachments[0].media[0].draftResourceId='changed';
 release({mimeType:'image/png',data:new Uint8Array(bytes)});
 assert.equal((await send)[0].draftResourceId,'blob');assert.deepEqual(owner.reads,[['txn','record','blob']]);
 `);
});

test("staging fails closed on foreign scope, duplicate media, missing bytes and whole-request bounds", async () => {
	await scenario(`
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not fetch')};const owner=draft();
 await assert.rejects(stageFrozenAttachmentResources({draft:{...owner,sessionId:'ps_other'},snapshot,fetchImpl}),{code:'ATT_INVALID_JSON'});
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot:{...snapshot,attachments:[...snapshot.attachments,{...snapshot.attachments[0],id:'another'}]},fetchImpl}),{code:'ATT_INVALID_JSON'});
 owner.readFrozenMedia=async()=>({mimeType:'image/jpeg',data:new Uint8Array(bytes)});
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl}),{code:'ATT_BYTES_MISSING'});
 owner.readFrozenMedia=async()=>({mimeType:'image/png',data:new Uint8Array(MAX_WEB_REQUEST_BODY_BYTES)});
 const oversized=structuredClone(snapshot);oversized.attachments[0].media[0].bytes=MAX_WEB_REQUEST_BODY_BYTES;
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot:oversized,fetchImpl}),{code:'ATT_LIMIT_EXCEEDED'});
 owner.readFrozenMedia=async()=>({mimeType:'image/png',data:new Uint8Array(MAX_WEB_REQUEST_BODY_BYTES-64)});
 oversized.attachments[0].media[0].bytes=MAX_WEB_REQUEST_BODY_BYTES-64;
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot:oversized,fetchImpl}),{code:'ATT_LIMIT_EXCEEDED'});
 assert.equal(calls,0);
 `);
});

test("staging checks server-derived hash and metadata, preserving retry scope on uncertain responses", async () => {
	await scenario(`
 const owner=draft();let calls=0;
 for(const tamper of [{sha256:'0'.repeat(64)},{bytes:4},{draftResourceId:'other'},{preparedUploadId:'not-attres'}]) {
  await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async request=>{calls++;return responseFor(request,tamper)}}),{code:'ATT_BYTES_MISSING'});
 }
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async request=>responseFor(request,{state:'accepted'})}),{code:'ATT_ACCEPTANCE_UNKNOWN'});
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async()=>{throw Error('offline')}}),{code:'ATT_STORAGE_FAILED'});
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async()=>new Response('not JSON',{status:201})}),{code:'ATT_STORAGE_FAILED'});
 await assert.rejects(stageFrozenAttachmentResources({draft:owner,snapshot,fetchImpl:async()=>Response.json({code:'ATT_STALE_REVISION',error:'different bytes'},{status:409})}),{code:'ATT_STALE_REVISION'});
 assert.equal(calls,4);
 `);
});
