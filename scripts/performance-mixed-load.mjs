import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {startWebOutboxProcessHost} from '../test/fixtures/web-outbox-process-harness.mjs';

// Real HTTP, SQLite writer/read workers, outbox and SSE; deterministic provider boundary.
// This bounded regression does not claim the plan's 10,000-admission sustained capacity SLO.
const directory=mkdtempSync(join(tmpdir(),'pibo-mixed-'));const tasks=[];const errors=[];
const metrics={profile:'10 sessions, 500 deltas/s, 100 tool events/s, concurrent navigation/history/SSE',model:'deterministic; no paid calls',offered:0,accepted:0,started:0,completed:0,maxConcurrent:0,reads:0,sseFrames:0,admissionMs:[],readMs:[],firstDeltaMs:[]};
let active=0,host,stop=false;const controllers=[];const acceptedAt=new Map();
const loop=monitorEventLoopDelay({resolution:10});loop.enable();
try{
 host=await startWebOutboxProcessHost({directory,piboSessionId:'ps_mixed_initial',onInput(event,emit){
  if(event.type!=='message')return;
  const task=(async()=>{
   metrics.started++;active++;metrics.maxConcurrent=Math.max(active,metrics.maxConcurrent);
   const base={piboSessionId:event.piboSessionId,eventId:event.id};
   emit({...base,type:'message_started',text:event.text,source:'user'});
   await delay(100);
   metrics.firstDeltaMs.push(performance.now()-(acceptedAt.get(event.text)??performance.now()));
   for(let i=0;i<100;i++){
    emit({...base,type:'assistant_delta',assistantIndex:0,text:'x'});
    if(i%5===0)emit({...base,type:'tool_execution_finished',toolCallId:'tool-'+i,toolName:'fixture',result:'ok',isError:false});
    await delay(20);
   }
   emit({...base,type:'assistant_message',assistantIndex:0,text:'x'.repeat(100)});
   emit({...base,type:'message_finished'});metrics.completed++;active--;
  })().catch(e=>errors.push(String(e)));tasks.push(task);
 }});
 const headers={'x-test-user':'user-1','content-type':'application/json',origin:host.baseURL};
 async function request(path,body){const start=performance.now();const res=await fetch(host.baseURL+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();assert.ok(res.ok,`${path}: ${res.status} ${JSON.stringify(data)}`);return {data,ms:performance.now()-start};}
 const {data:{room}}=await request('/api/chat/rooms',{name:'Mixed workload'});
 const sessions=[];
 for(let i=0;i<10;i++){const {data}=await request('/api/chat/sessions',{roomId:room.id,profile:'base'});sessions.push(data.session.id);}
 const streams=await Promise.all(sessions.map(async(sid,index)=>{
  const ctrl=new AbortController();controllers.push(ctrl);
  const res=await fetch(host.baseURL+`/api/chat/events?piboSessionId=${sid}&since=0`,{headers,signal:ctrl.signal});assert.equal(res.status,200);
  return {run:(async()=>{const reader=res.body.getReader();try{for(;;){const {value,done}=await reader.read();if(done)break;metrics.sseFrames+=(new TextDecoder().decode(value).match(/data: /g)??[]).length;if(index===9)await delay(100);}}catch(e){if(!ctrl.signal.aborted)errors.push(String(e));}})()};
 }));
 const reads=(async()=>{while(!stop){for(const path of [`/api/chat/navigation?piboSessionId=${sessions[0]}`,`/api/chat/trace/timeline?piboSessionId=${sessions[1]}`,`/api/chat/rooms/${room.id}/events`]){const r=await request(path);metrics.readMs.push(r.ms);metrics.reads++;}await delay(40);}})();
 for(let round=0;round<3;round++){
  await Promise.all(sessions.map(async(sid,index)=>{const text=`mixed-${round}-${index}`;acceptedAt.set(text,performance.now());metrics.offered++;const r=await request('/api/chat/message',{roomId:room.id,piboSessionId:sid,clientTxnId:text,text});metrics.accepted++;metrics.admissionMs.push(r.ms);}));
  for(let n=0;metrics.completed<(round+1)*10&&n<300;n++)await delay(100);
  assert.equal(metrics.completed,(round+1)*10);
 }
 await Promise.all(tasks);await host.app.drain();stop=true;await reads;
 const persisted=await request(`/api/chat/rooms/${room.id}/events`);
 metrics.persistedAnswers=persisted.data.events.filter(e=>e.payload?.type==='assistant_message').length;
 metrics.persistedToolResults=persisted.data.events.filter(e=>e.payload?.type==='tool_execution_finished').length;
 assert.equal(metrics.persistedAnswers,30);assert.equal(metrics.persistedToolResults,600);
 for(const c of controllers)c.abort();await Promise.all(streams.map(s=>s.run));
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(metrics.maxConcurrent,10);assert.equal(metrics.completed,30);assert.ok(metrics.sseFrames>3000);assert.ok(metrics.reads>20);
 const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
 for(const field of ['admissionMs','readMs','firstDeltaMs']){const values=metrics[field];metrics[field]={count:values.length,p95:percentile(values,.95),p99:percentile(values,.99),max:Math.max(...values)};}
 metrics.eventLoop={p99Ms:loop.percentile(99)/1e6,maxMs:loop.max/1e6};metrics.errors=errors;metrics.rssBytes=process.memoryUsage().rss;
 const output=process.argv[2]??'/tmp/performance-mixed-load.json';writeFileSync(output,JSON.stringify(metrics,null,2)+'\n');console.log(JSON.stringify(metrics,null,2));
}finally{stop=true;loop.disable();for(const c of controllers)c.abort();await Promise.allSettled(tasks);await host?.channel.stop();await host?.app.dispose();rmSync(directory,{recursive:true,force:true});}
