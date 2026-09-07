import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {AsyncChatReadQueries} from '../dist/data/async-chat-reads.js';
import {startWebOutboxProcessHost} from './fixtures/web-outbox-process-harness.mjs';

test('file history reads run on a separate worker and large bodies remain explicitly referenced',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-read-worker-'));const path=join(root,'db.sqlite'),payloadRootDir=join(root,'payloads');
 const store=new PiboDataStore(path,{payloadRootDir});const reader=new AsyncChatReadQueries(path,payloadRootDir);
 try{
  const payload=store.payloads.writePayload({value:'x'.repeat(1024*1024),contentType:'text/plain',retentionClass:'product_history'});
  store.messages.insertMessage({id:'message',sessionId:'session',sequence:1,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'preview',contentPayloadRef:payload.id});
  const entries=await reader.history.listProductHistoryEntries({piboSessionId:'session',limit:50});
  assert.equal(entries[0].content,'preview');assert.equal(entries[0].metadata.payloadRef,payload.id);assert.equal(entries[0].metadata.contentTruncated,true);
  const {parseTracePayloadRef,readTracePayloadChunk}=await import('../dist/apps/chat/trace-v2.js');
  const fullRef=entries[0].metadata.tracePayloadRef;assert.equal(fullRef.byteLength,1024*1024);assert.equal(parseTracePayloadRef(fullRef.ref).payloadId,payload.id);
  const chunk=readTracePayloadChunk({payloadStore:store.payloads,ref:fullRef.ref,offset:0,limit:1024});assert.ok(chunk);
  assert.equal(entries[0].metadata.contentBytes,1024*1024);
  assert.equal((await reader.history.getProductHistoryCoverage('session')).messageCount,1);
  assert.ok(reader.status().worker.threadId>0);assert.equal(reader.status().worker.readOnly,true);
  assert.equal((await reader.maintenance('pause')).paused,true);assert.equal((await reader.maintenance('resume')).paused,false);
  const readonly=new PiboDataStore(path,{payloadRootDir,readOnly:true});try{assert.throws(()=>readonly.db.exec("DELETE FROM chat_messages"),/readonly/i);}finally{readonly.close();}
 }finally{await reader.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('authenticated trace cache hits precede reconstruction and invalidate on durable and scope changes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pibo-trace-cache-'));let host;let revision=0;
 try{
  host=await startWebOutboxProcessHost({directory,piboSessionId:'ps_cache',structureRevision:()=>revision});
  const headers={'x-test-user':'user-1'};const url=host.baseURL+'/api/chat/trace/summary?piboSessionId=ps_cache';
  const first=await fetch(url,{headers});assert.equal(first.status,200);await first.json();
  const cached=await fetch(url,{headers});assert.match(cached.headers.get('server-timing'),/watermark-hit/);const etag=cached.headers.get('etag');await cached.json();
  const unchanged=await fetch(url,{headers:{...headers,'if-none-match':etag}});assert.equal(unchanged.status,304);
  const unauthorized=await fetch(url);assert.notEqual(unauthorized.status,200);assert.doesNotMatch(unauthorized.headers.get('server-timing')??'',/watermark-hit/);
  host.emitOutput({type:'assistant_message',piboSessionId:'ps_cache',eventId:'new-output',assistantIndex:0,text:'new answer'});await host.app.drain();
  const changed=await fetch(url,{headers});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),etag);assert.doesNotMatch(changed.headers.get('server-timing'),/watermark-hit/);await changed.json();
  revision++;const scope=await fetch(url,{headers});assert.doesNotMatch(scope.headers.get('server-timing'),/watermark-hit/);await scope.json();
 }finally{await host?.channel.stop();await host?.app.dispose();rmSync(directory,{recursive:true,force:true});}
});


test('read worker replacement waits for exit and preserves projections',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-read-restart-')),path=join(root,'db.sqlite'),payloadRootDir=join(root,'payloads');
 const store=new PiboDataStore(path,{payloadRootDir}),reader=new AsyncChatReadQueries(path,payloadRootDir);
 try{
  store.messages.insertMessage({id:'persisted',sessionId:'session',sequence:1,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'survives reader crash'});
  assert.equal((await reader.history.getProductHistoryCoverage('session')).messageCount,1);
  const firstThread=reader.status().worker.threadId;
  await reader.client.worker.terminate();
  await new Promise(resolve=>setTimeout(resolve,1050));
  assert.equal((await reader.history.getProductHistoryCoverage('session')).messageCount,1);
  assert.equal(reader.status().restarts,1);assert.notEqual(reader.status().worker.threadId,firstThread);
  await reader.close();await assert.rejects(reader.history.getProductHistoryCoverage('session'),{code:'storage_closed'});
 }finally{await reader.close();store.close();rmSync(root,{recursive:true,force:true});}
});


test('navigation status pages use stable bounded keysets without dropping sessions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-navigation-page-')),path=join(root,'db.sqlite'),payloadRootDir=join(root,'payloads');
 const store=new PiboDataStore(path,{payloadRootDir});let reader;
 try{
  const {ChatSessionQueryService}=await import('../dist/apps/chat/data/session-query-service.js');
  const {InMemoryPiboSessionStore}=await import('../dist/sessions/store.js');
  const {ChatRoomService}=await import('../dist/apps/chat/data/room-service.js');
  new ChatRoomService(store).ensureDefaultRoom();
  const sessions=new InMemoryPiboSessionStore(),index=new ChatSessionQueryService(store);
  const ids=[];store.transaction(()=>{for(let i=0;i<1101;i++){const session=sessions.create({channel:'test',kind:'chat',profile:'base',metadata:{chatRoomId:'room_default'}});ids.push(session.id);index.upsertSession(session);}});
  reader=new AsyncChatReadQueries(path,payloadRootDir);
  let afterId;const read=[];
  for(;;){const page=await reader.navigation.sessionIndexPage({roomId:'room_default',afterId,limit:10000});assert.ok(page.length<=500);read.push(...page.map(s=>s.piboSessionId));if(page.length<500)break;afterId=page.at(-1).piboSessionId;}
  assert.deepEqual(read,ids.sort());
  const plan=store.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM sessions WHERE room_id=? AND deleted_at IS NULL AND id>? ORDER BY id LIMIT 500").all('room_default','');assert.match(JSON.stringify(plan),/idx_sessions_navigation_cursor/);assert.doesNotMatch(JSON.stringify(plan),/TEMP B-TREE/);
 }finally{await reader?.close();store.close();rmSync(root,{recursive:true,force:true});}
});
