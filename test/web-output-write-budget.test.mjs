import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PiboReliabilityStore} from '../dist/reliability/store.js';
import {startWebOutboxProcessHost} from './fixtures/web-outbox-process-harness.mjs';
test('semantic output keeps its durable receipt with at most two full-envelope checkpoint rewrites',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pibo-output-write-budget-')),sid='ps_write_budget';let host;const counts=new Map();
 const original=PiboReliabilityStore.prototype.updateJobPayload;
 PiboReliabilityStore.prototype.updateJobPayload=function(id,owner,payload,token){for(const delivery of payload?.state?.deliveries??[])if(delivery.event.piboSessionId===sid)counts.set(delivery.event.eventId,(counts.get(delivery.event.eventId)??0)+1);return original.call(this,id,owner,payload,token);};
 try{
  host=await startWebOutboxProcessHost({directory,piboSessionId:sid});await fetch(host.baseURL+'/api/chat/sessions',{headers:{'x-test-user':'user-1'}});
  for(const event of [{type:'assistant_message',eventId:'answer',assistantIndex:0,text:'x'.repeat(65536)},{type:'tool_execution_finished',eventId:'tool',toolCallId:'call',toolName:'read',isError:false,result:{content:[{type:'text',text:'y'.repeat(65536)}]}}]){
   host.emitOutput({...event,piboSessionId:sid});await host.app.drain();
   assert.ok(counts.get(event.eventId)>0 && counts.get(event.eventId)<=2,`full envelope rewrite budget exceeded: ${counts.get(event.eventId)}`);
  }
  const data=new DatabaseSync(host.paths.dataStorePath,{readOnly:true}),reliability=new DatabaseSync(host.paths.reliabilityStorePath,{readOnly:true});
  try{
   assert.equal(data.prepare('SELECT count(*) n FROM event_log WHERE session_id=?').get(sid).n,2);
   assert.equal(reliability.prepare('SELECT count(*) n FROM pibo_delivery_receipts').get().n,2);
   assert.equal(reliability.prepare("SELECT count(*) n FROM pibo_jobs WHERE queue='output-persistence'").get().n,0);
  }finally{data.close();reliability.close();}
 }finally{PiboReliabilityStore.prototype.updateJobPayload=original;await host?.channel.stop?.();await host?.app.dispose?.();rmSync(directory,{recursive:true,force:true});}
});
