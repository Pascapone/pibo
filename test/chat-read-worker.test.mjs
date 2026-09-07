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
