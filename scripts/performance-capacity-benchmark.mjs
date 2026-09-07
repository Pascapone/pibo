import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { AsyncChatStorage } from '../dist/data/async-chat-storage.js';
import { ChatRoomService } from '../dist/apps/chat/data/room-service.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
const {values}=parseArgs({options:{help:{type:'boolean'},events:{type:'string',default:'1000000'},samples:{type:'string',default:'10000'},sessions:{type:'string',default:'10'},'payload-bytes':{type:'string',default:'1024'},output:{type:'string'}}});
if(values.help){console.log('Isolated durable-admission/fair-dispatch benchmark; no provider or HTTP simulation claims.\n--events <0..10000000> --samples <1..100000> --sessions <1..20> --payload-bytes <1..1048576> --output <json>\nCreates and deletes its own synthetic database. Run only inside a Docker worker or owned Pibo2 pool slot.');process.exit(0);}
const events=Number(values.events),samples=Number(values.samples),width=Number(values.sessions),payloadBytes=Number(values['payload-bytes']);
for(const [n,min,max] of [[events,0,10_000_000],[samples,1,100_000],[width,1,20],[payloadBytes,1,1048576]])if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Invalid bounded benchmark option');
const root=mkdtempSync(join(tmpdir(),'pibo-capacity-bench-'));
const store=new PiboDataStore(join(root,'data.sqlite'),{payloadRootDir:join(root,'payloads')});
let storage;
const stats=list=>{const a=[...list].sort((a,b)=>a-b);const p=q=>a[Math.min(a.length-1,Math.ceil(q*a.length)-1)];return {samples:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)};};
try {
 const rooms=new ChatRoomService(store);const noisy=rooms.createRoom({name:'Large synthetic room',type:'chat'});const quiet=rooms.createRoom({name:'Small synthetic room',type:'chat'});
 const insert=store.db.prepare("INSERT INTO event_log(room_id,session_id,session_sequence,topic,type,source,idempotency_key,retention_class,attributes_json,created_at) VALUES(?,'ps_history',?,'pibo.output','tool_execution_finished','benchmark',?,'trace_event',?,'2026-09-07T00:00:00Z')");
 const attrs=JSON.stringify({toolName:'read',summary:'Synthetic historical output. '.repeat(8)});
 for(let offset=0;offset<events;offset+=1000)store.transaction(()=>{for(let i=offset;i<Math.min(events,offset+1000);i++)insert.run(noisy.id,i+1,`history:${i}`,attrs);});
 console.error(`Seeded ${events} valid historical events; starting admission sample.`);
 const sessions=new InMemoryPiboSessionStore();
 const targets=Array.from({length:width},(_,i)=>sessions.create({channel:'benchmark',kind:'chat',profile:'base',metadata:{chatRoomId:i===width-1?quiet.id:noisy.id}}));
 storage=new AsyncChatStorage(store.path,join(root,'payloads'),{maxAgeMs:2000});
 const readyDeadline=Date.now()+10000;
 while(!storage.status().ready){if(storage.status().closed||Date.now()>readyDeadline)throw new Error('Benchmark writer did not become ready');await new Promise(resolve=>setTimeout(resolve,10));}
 await storage.resolveRoom(noisy.id,true);
 const text='x'.repeat(payloadBytes);
 const timings=[],quietTimings=[],baseline=[],rss=[];let completed=0,rejected=0,sequence=0,peakPendingBytes=0;
 const drain=async()=>{for(;;){const claim=await storage.claimCommand('benchmark',30000);if(!claim)break;if(!await storage.transitionCommand(claim.id,'benchmark',claim.token,'completed'))throw new Error('Lost command claim');completed++;}};
 const admit=async(session,bucket)=>{
  const key=`bench-${++sequence}`,start=performance.now(),roomId=session.metadata.chatRoomId;
  try {
   const result=await storage.admit({roomId,piboSessionId:session.id,eventType:'user.message.accepted',actorType:'user',actorId:'benchmark',clientTxnId:key,retentionClass:'chat_message',payload:{type:'user.message.accepted',text,clientTxnId:key}},session,text,{eventId:key,delivery:'queue'});
   if(!result.created||result.receipt.state!=='accepted')throw new Error('Unexpected admission identity');
   bucket.push(performance.now()-start);
  } catch(error){if(error.code!=='storage_overloaded'&&error.code!=='command_overloaded')throw error;rejected++;}
 };
 // A warm quiet-session baseline uses the same database, writer and payload size.
 for(let i=0;i<100;i++){await admit(targets.at(-1),baseline);await drain();}
 const loop=monitorEventLoopDelay({resolution:10});loop.enable();const started=performance.now();
 for(let offset=0;offset<samples;offset+=width){
  const batch=targets.slice(0,Math.min(width,samples-offset));
  const jobs=batch.map(session=>admit(session,session===targets.at(-1)?quietTimings:timings));
  peakPendingBytes=Math.max(peakPendingBytes,storage.status().writer.pendingBytes);
  await Promise.all(jobs);await drain();
  if(offset%(width*10)===0)rss.push(process.memoryUsage().rss);
 }
 loop.disable();
 const accepted=timings.length+quietTimings.length;
 if(completed!==accepted+baseline.length)throw new Error('Acknowledged commands not all terminal');
 const result={at:new Date().toISOString(),node:process.version,fixture:{events,sessions:width,payloadBytes,requestedSamples:samples},scope:'Synthetic worker admission plus fenced immediate dispatch completion. No real provider, HTTP, browser, sustained-rate or full integrated SLO claim. Warm fixture; cache residency unverified.',elapsedMs:performance.now()-started,accepted,rejected,completed,admissionMs:stats([...timings,...quietTimings]),quietMs:stats(quietTimings),quietBaselineMs:stats(baseline),quietP95Ratio:stats(quietTimings).p95/stats(baseline).p95,peakPendingBytes,rssBytes:{first:rss[0],last:rss.at(-1),max:Math.max(...rss),samples:rss.length},callerEventLoopMs:{p99:loop.percentile(99)/1e6,max:loop.max/1e6},storage:storage.status()};
 const json=JSON.stringify(result,null,2);if(values.output)writeFileSync(values.output,json+'\n');console.log(json);
}finally{await storage?.close();store.close();rmSync(root,{recursive:true,force:true});}
