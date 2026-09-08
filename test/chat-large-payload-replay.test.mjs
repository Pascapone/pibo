import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startWebOutboxProcessHost} from './fixtures/web-outbox-process-harness.mjs';
import {buildTraceViewFromEvents} from '../dist/shared/trace-engine.js';
import {applyTraceLiveEvents} from '../dist/shared/trace-live-reducer.js';

async function readRef(reader, type) {
 const decoder=new TextDecoder();let buffer='';
 for (;;) {
  const {value,done}=await reader.read();assert.equal(done,false,'stream ended before referenced output');buffer+=decoder.decode(value,{stream:true});
  let end;
  while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').find(line=>line.startsWith('data: '));if(!data)continue;const event=JSON.parse(data.slice(6));if(event.type==='RAW_EVENT'&&event.event?.type===type&&event.storedPayloadRef)return event;}
 }
}

test('large live outputs retain full references across SSE replay and timeline', {timeout:60000}, async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pibo-large-replay-'));let host;const controllers=[];
 const headers={'x-test-user':'user-1'};
 try{
  host=await startWebOutboxProcessHost({directory,piboSessionId:'ps_large_replay'});
  const get=path=>fetch(host.baseURL+path,{headers});
  await (await get('/api/chat/navigation?piboSessionId=ps_large_replay')).json();
  for(const type of ['assistant_message','tool_execution_finished']){
   const ctrl=new AbortController();controllers.push(ctrl);
   const response=await fetch(host.baseURL+'/api/chat/events?piboSessionId=ps_large_replay&since=0',{headers,signal:ctrl.signal});
   assert.equal(response.status,200);const reader=response.body.getReader();
   const live=readRef(reader,type);
   const text='ä🙂'.repeat(300000)+'COMPLETE_END';
   const event={type,piboSessionId:'ps_large_replay',eventId:'turn-'+type,...(type==='assistant_message'?{assistantIndex:0,text}:{toolCallId:'call-large',toolName:'fixture',result:text,isError:false})};
   host.emitOutput(event);await host.app.drain();
   const frame=await live;assert.ok(frame.storedPayloadRef.byteLength>1024*1024);assert.ok(JSON.stringify(frame).length<65536);
   let seq=0;const reduced=applyTraceLiveEvents({currentEvents:[],streamEvents:[frame],piboSessionId:'ps_large_replay',nextSequence:()=>++seq});assert.equal(reduced[0].storedPayloadRef.ref,frame.storedPayloadRef.ref);
   const projected=buildTraceViewFromEvents({session:{id:'ps_large_replay',piSessionId:''},events:reduced});
   const flatten=nodes=>nodes.flatMap(n=>[n,...flatten(n.children??[])]);
   assert.ok(flatten(projected.nodes).some(n=>Object.values(n.payloadRefs??{}).some(r=>r.ref===frame.storedPayloadRef.ref)), 'live projection must expose referenced content');
   ctrl.abort();
   const reconnect=new AbortController();controllers.push(reconnect);
   const replay=await fetch(host.baseURL+'/api/chat/events?piboSessionId=ps_large_replay&since=0',{headers,signal:reconnect.signal});
   const replayed=await readRef(replay.body.getReader(),type);assert.equal(replayed.storedPayloadRef.ref,frame.storedPayloadRef.ref);reconnect.abort();
   let restored='',offset=0;
   for(;;){const res=await get('/api/chat/trace/payload/'+encodeURIComponent(frame.storedPayloadRef.ref)+`?offset=${offset}&limit=65536`);assert.equal(res.status,200);const chunk=await res.json();restored+=chunk.data;if(!chunk.hasMore)break;assert.ok(chunk.nextOffset>offset);offset=chunk.nextOffset;}
   assert.equal(type==='assistant_message'?restored:JSON.parse(restored),text);
   const timeline=await (await get('/api/chat/trace/timeline?piboSessionId=ps_large_replay')).json();
   const refs=timeline.nodes.flatMap(n=>Object.values(n.payloadRefs??{}));
   assert.ok(refs.some(r=>r.hash===frame.storedPayloadRef.hash && r.byteLength===frame.storedPayloadRef.byteLength),'timeline must reference the same complete content');
  }
 }finally{for(const c of controllers)c.abort();await host?.channel.stop();await host?.app.dispose();rmSync(directory,{recursive:true,force:true});}
});
