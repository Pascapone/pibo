import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);
const prelude = `
import assert from 'node:assert/strict';
import {addWithProvider, updateWithProvider, freezeWithProviderPins} from './src/apps/chat-ui/src/attachments/core-attachment-provider-commands.ts';
import {coreNoteProvider} from './src/attachments/core-providers.ts';
const sessionId='ps_test'; const scope={sessionId};
const pin={type:'example/stick',pluginId:'example',contributionId:'example/stick',revision:'r1',contentHash:'hash'};
const events=[];
const plugin={type:'example/stick',schemaVersions:[1],schemas:{1:{type:'object',required:['text'],properties:{text:{type:'string',minLength:1}}}},
 validate(value){events.push('validate');},snapshot(source){events.push('snapshot');return {text:source.text};},
 serializeForMessage(frozen){events.push('serialize');return {kind:'json',type:this.type,json:frozen.payload};},
 renderTile(){return {title:'stick',kind:'custom'};},fallbackTitle(){return 'stick';},sizeHint(){return {tile:'s'};}};
const lookup=(type,request)=>request.sessionId===sessionId ? ({'example/stick':plugin,'pibo.core/note':coreNoteProvider})[type] : undefined;
const getPin=(type,request)=> request.sessionId===sessionId && type===plugin.type ? pin : undefined;
function facade(records=[]) {let calls=[];return {sessionId, calls,
 async load(){calls.push('load');return {revision:3,view:{records:structuredClone(records),openSnapshots:[],acceptedTransactions:[],preparedUploads:{},preparedSubmissions:{}}};},
 async execute(revision,command,blobs){calls.push({revision,command,blobs});return {result:command.kind==='add'?'att_new':command.kind==='freeze'?{sessionId,clientTxnId:command.clientTxnId,text:command.text,attachments:records.map(r=>({id:r.envelope.id,revision:r.envelope.revision,type:r.envelope.type,schemaVersion:r.envelope.schemaVersion,payload:structuredClone(r.payload),...(r.media?{media:structuredClone(r.media)}:{})})),frozenAt:'clock'}:undefined,current:{revision:revision+1}};}
 };}
function record(type, id, payload, media){return {envelope:{id,sessionId,type,schemaVersion:1,revision:1},payload,...(media?{media}:{})};}
`;
async function scenario(script) {
	await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", prelude + script],
		{ cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
}

test("provider-aware add snapshots and validates before constructing one data-only byte command", async () => {
	await scenario(`
 const draft=facade(); const source={text:'first'}; const raw=new Uint8Array([1,2,3]);
 const media=[{draftResourceId:'blob',mimeType:'image/png',bytes:3}];
 const outcome=await addWithProvider({draft,lookup,scope,expectedRevision:0,type:'example/stick',schemaVersion:1,source,media,newBlobs:[{blobId:'blob',mimeType:'image/png',data:raw}]});
 assert.deepEqual(outcome,{attachmentId:'att_new',revision:1});
 assert.deepEqual(events,['snapshot','validate']); assert.equal(draft.calls.length,1);
 const captured=draft.calls[0]; assert.equal(captured.command.input.payload.text,'first');
 assert.equal(captured.blobs[0].data[0],1); source.text='changed';raw[0]=8;media[0].bytes=99;
 assert.equal(captured.command.input.payload.text,'first');assert.equal(captured.blobs[0].data[0],1);assert.equal(captured.command.input.media[0].bytes,3);
 `);
});

test("provider add denies foreign Session, missing providers, schema violations, async callbacks and byte mismatches before storage", async () => {
	await scenario(`
 const draft=facade(); const base={draft,lookup,scope,expectedRevision:0,type:'example/stick',schemaVersion:1,source:{text:'ok'}};
 await assert.rejects(addWithProvider({...base,scope:{sessionId:'ps_foreign'}}),{code:'ATT_ACCESS_DENIED'});
 await assert.rejects(addWithProvider({...base,type:'missing'}),{code:'ATT_PROVIDER_MISSING'});
 await assert.rejects(addWithProvider({...base,source:{text:''}}),{code:'ATT_SCHEMA_MISMATCH'});
 await assert.rejects(addWithProvider({...base,expectedRevision:-1}),{code:'ATT_INVALID_JSON'});
 await assert.rejects(addWithProvider({...base,schemaVersion:0}),{code:'ATT_INVALID_JSON'});
 await assert.rejects(addWithProvider({...base,media:[{draftResourceId:'bad',mimeType:'invalid mime',bytes:1}],newBlobs:[{blobId:'bad',mimeType:'invalid mime',data:new Uint8Array([1])}]}),{code:'ATT_INVALID_JSON'});
 await assert.rejects(addWithProvider({...base,media:[{draftResourceId:'a',mimeType:'image/png',bytes:1}]}),{code:'ATT_BYTES_MISSING'});
 await assert.rejects(addWithProvider({...base,media:[{draftResourceId:'a',mimeType:'image/png',bytes:1}],newBlobs:[{blobId:'a',mimeType:'image/png',data:new Uint8Array([1,2])}]}),{code:'ATT_INVALID_JSON'});
 const original=plugin.snapshot;plugin.snapshot=()=>Promise.reject(new Error('unsupported async'));
 await assert.rejects(addWithProvider(base),{code:'ATT_MATERIALIZE_FAILED'});
 plugin.snapshot=original; const validate=plugin.validate;plugin.validate=()=>Promise.reject(new Error('unsupported async'));
 await assert.rejects(addWithProvider(base),{code:'ATT_MATERIALIZE_FAILED'});
 plugin.validate=validate;assert.equal(draft.calls.length,0); await new Promise(resolve=>setTimeout(resolve,0));
 `);
});

test("provider-aware update captures live type/schema expectations and does not request a media edit", async () => {
	await scenario(`
 const draft=facade([record('example/stick','att_old',{text:'original'},[{draftResourceId:'b',mimeType:'image/png',bytes:2}])]);
 const source={text:'updated'};
 const result=await updateWithProvider({draft,lookup,scope,expectedRevision:3,id:'att_old',expectedRecordRevision:1,source});
 assert.equal(result.revision,4);assert.equal(draft.calls[1].command.kind,'update');
 assert.deepEqual(draft.calls[1].command.next,{payload:{text:'updated'}});
 assert.equal(draft.calls[1].command.expectedType,'example/stick');assert.equal(draft.calls[1].command.expectedSchemaVersion,1);
 source.text='mutated';assert.equal(draft.calls[1].command.next.payload.text,'updated');
 await assert.rejects(updateWithProvider({draft,lookup,scope,expectedRevision:3,id:'att_old',expectedRecordRevision:2,source}),{code:'ATT_STALE_REVISION'});
 assert.equal(draft.calls.filter(c=>typeof c==='object').length,1);
 `);
});

test("freeze preflights selected providers outside the transaction and captures one pin per plugin type", async () => {
	await scenario(`
 const draft=facade([record('pibo.core/note','att_core',{text:'note'}),record('example/stick','att_1',{text:'one'}),record('example/stick','att_2',{text:'two'})]);
 const value=await freezeWithProviderPins({draft,lookup,scope,expectedRevision:3,getPin,clientTxnId:'txn',text:'hi'});
 assert.deepEqual(value.pins,[pin]);assert.equal(value.revision,4);assert.equal(value.snapshot.attachments.length,3);
 const position=draft.calls.findIndex(c=>typeof c==='object');assert.ok(position>0);
 assert.equal(events.filter(event=>event==='validate').length,2);
 assert.equal(events.includes('serialize'),false,'resource-dependent serialization runs only at server admission');
 `);
});

test("freeze rejects invalid input, absent pins, drift and stale storage without publishing a send result", async () => {
	await scenario(`
 const draft=facade([record('example/stick','att',{text:'a'})]);
 const base={draft,lookup,scope,expectedRevision:3,getPin,clientTxnId:'txn',text:'hi'};
 for(const bad of [{...base,text:null},{...base,clientTxnId:''},{...base,expectedRevision:-1}]) await assert.rejects(freezeWithProviderPins(bad),{code:'ATT_INVALID_JSON'});
 assert.equal(events.length,0,'invalid scalar input never invokes a provider');
 await assert.rejects(freezeWithProviderPins({...base,getPin:()=>undefined}),{code:'ATT_PROVIDER_MISSING'});
 assert.equal(draft.calls.filter(c=>typeof c==='object').length,0);
 let reads=0;await assert.rejects(freezeWithProviderPins({...base,getPin:()=>reads++?{...pin,revision:'new'}:pin}),{code:'ATT_PROVIDER_MISSING'});
 assert.equal(draft.calls.filter(c=>typeof c==='object').length,1,'drift after commit leaves one local snapshot but publishes no send result');
 const stale=facade([record('example/stick','att',{text:'a'})]);stale.execute=async()=>{throw Object.assign(new Error('stale'),{code:'ATT_STALE_REVISION'});};
 await assert.rejects(freezeWithProviderPins({...base,draft:stale}),{code:'ATT_STALE_REVISION'});
 await assert.rejects(freezeWithProviderPins({...base,expectedRevision:4}),{code:'ATT_STALE_REVISION'});
 `);
});

test("provider freeze rejects post-CAS content and executable drift even when the pin is unchanged", async () => {
 await scenario(`
 const draft=facade([record('example/stick','att',{text:'original'})]);
 const base={draft,scope,expectedRevision:3,getPin,clientTxnId:'txn',text:'hi'};
 let selected=plugin;const live=(type,requested)=>requested.sessionId===sessionId && type===selected.type?selected:undefined;
 const original=draft.execute.bind(draft);
 draft.execute=async (...args)=>{const result=await original(...args);result.result.attachments[0].payload.text='different';return result;};
 await assert.rejects(freezeWithProviderPins({...base,lookup:live}),{code:'ATT_STALE_REVISION'});
 draft.execute=async (...args)=>{const result=await original(...args);selected={...plugin};return result;};
 await assert.rejects(freezeWithProviderPins({...base,lookup:live}),{code:'ATT_PROVIDER_MISSING'});
 const stable=facade([record('example/stick','att',{text:'original'})]);
 const value=await freezeWithProviderPins({...base,draft:stable,lookup,getPin:()=>({...pin,unexpected:'omitted'})});
 assert.deepEqual(value.pins,[pin]);
 `);
});
