import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {AsyncTelemetryWriter} from '../dist/data/telemetry-writer.js';
import {PiboRuntimeTelemetryRecorder} from '../dist/core/runtime-telemetry.js';
import {PiboProviderTelemetryRecorder} from '../dist/core/provider-telemetry.js';
import {AsyncChatStorage} from '../dist/data/async-chat-storage.js';
import {ChatRoomService} from '../dist/apps/chat/data/room-service.js';
import {InMemoryPiboSessionStore} from '../dist/sessions/store.js';
const {values}=parseArgs({options:{help:{type:'boolean'},seconds:{type:'string',default:'60'},'payload-bytes':{type:'string',default:'1024'},output:{type:'string'}}});
if(values.help){console.log('Isolated telemetry plus product-writer contention measurement.\n--seconds <1..600> --payload-bytes <1..1048576> --output <json>\nTargets 500 diagnostic deltas/s, 100 product tool outputs/s and 5 durable admissions/s across ten Sessions. No runtime/provider/browser/outbox orchestration. Own fixture only.');process.exit(0);}
const seconds=Number(values.seconds),size=Number(values['payload-bytes']);
if(!Number.isSafeInteger(seconds)||seconds<1||seconds>600||!Number.isSafeInteger(size)||size<1||size>1048576)throw Error('Invalid benchmark bounds');
const root=mkdtempSync(join(tmpdir(),'pibo-telemetry-bench-')),path=join(root,'db.sqlite'),payloadRoot=join(root,'payloads');
const store=new PiboDataStore(path,{payloadRootDir:payloadRoot});const rooms=new ChatRoomService(store);const noisy=rooms.createRoom({name:'Synthetic noisy'}),quiet=rooms.createRoom({name:'Synthetic quiet'});
const sessions=new InMemoryPiboSessionStore();const targets=Array.from({length:10},(_,i)=>sessions.create({channel:'benchmark',kind:'chat',profile:'base',metadata:{chatRoomId:i===9?quiet.id:noisy.id}}));
const writer=new AsyncTelemetryWriter(store.telemetry,{measure:true});const recorder=new PiboRuntimeTelemetryRecorder(store.telemetry,undefined,{writer});const storage=new AsyncChatStorage(path,payloadRoot);const pending=new Set();
const timings={admission:[],output:[]};const failures={};const loop=monitorEventLoopDelay({resolution:10});const text='x'.repeat(size);let completedCommands=0;let deltas=0,outputs=0,admissions=0,producerRefused=0,peakPending=0,peakTelemetryBytes=0;const rss=[];
const stats=xs=>{const a=xs.slice().sort((a,b)=>a-b);return {count:a.length,p95:a[Math.ceil(a.length*.95)-1]??0,p99:a[Math.ceil(a.length*.99)-1]??0,max:a.at(-1)??0};};
function launch(kind,task,after){if(pending.size>=128){producerRefused++;return;}const start=performance.now();const job=task().then(async value=>{timings[kind].push(performance.now()-start);await after?.(value);}).catch(error=>{const key=error.code??'unknown';failures[key]=(failures[key]??0)+1;}).finally(()=>pending.delete(job));pending.add(job);peakPending=Math.max(peakPending,pending.size);}
try {
 while(!storage.status().ready)await delay(5);
 const providers=targets.map(session=>new PiboProviderTelemetryRecorder({store:store.telemetry,writer,session,model:{provider:'benchmark',id:'synthetic'}}));
 for(const [i,session] of targets.entries()){recorder.recordOutput({type:'message_started',piboSessionId:session.id,eventId:`turn-${session.id}`,text:'synthetic',source:'user'},{session});providers[i].recordRequestStart({model:'synthetic'});providers[i].recordResponse({status:200});}
 await writer.flush();loop.enable();const start=performance.now();
 while(performance.now()-start<seconds*1000){
  const elapsed=Math.min(seconds,(performance.now()-start)/1000);
  for(let i=0;deltas<Math.floor(elapsed*500)&&i<100;i++,deltas++){const session=targets[deltas%10];recorder.recordOutput({type:'assistant_delta',piboSessionId:session.id,eventId:`turn-${session.id}`,assistantIndex:0,contentIndex:0,text:'x'},{session});}
  for(let i=0;outputs<Math.floor(elapsed*100)&&i<25;i++,outputs++){const session=targets[outputs%10],id=`tool-${outputs}`;const event={type:'tool_execution_finished',piboSessionId:session.id,eventId:`turn-${session.id}`,toolCallId:id,toolName:'benchmark',isError:false,result:{content:[{type:'text',text}]}};recorder.recordOutput(event,{session});launch('output',()=>storage.ingestOutput({session,roomId:session.metadata.chatRoomId,event}));}
  for(;admissions<Math.floor(elapsed*5);admissions++){const session=targets[admissions%10],id=`admission-${admissions}`,roomId=session.metadata.chatRoomId;launch('admission',()=>storage.admit({roomId,piboSessionId:session.id,eventType:'user.message.accepted',actorType:'user',actorId:'benchmark',clientTxnId:id,retentionClass:'chat_message',payload:{type:'user.message.accepted',text:'hello',clientTxnId:id}},session,'hello',{eventId:id,delivery:'queue'}),async()=>{const claim=await storage.claimCommand('benchmark',30000);if(!claim||!await storage.transitionCommand(claim.id,'benchmark',claim.token,'completed'))throw Error('Acknowledged benchmark command lost');completedCommands++;});}
  peakTelemetryBytes=Math.max(peakTelemetryBytes,writer.status().pendingBytes);rss.push(process.memoryUsage().rss);await delay(25);
 }
 await Promise.all(pending);
 for(const provider of providers)provider.recordMessageEnd({role:'assistant',stopReason:'stop'});
 for(const session of targets)recorder.recordOutput({type:'message_finished',piboSessionId:session.id,eventId:`turn-${session.id}`,source:'user'},{session});
 await writer.flush();loop.disable();
 const result={at:new Date().toISOString(),scope:'Synthetic storage-worker/telemetry contention. Diagnostic SQL statement executions classify UPSERT by its leading INSERT verb; these are not physical row-insert counts. WAL size is observed file length, not fsync count or cumulative WAL writes. No provider, browser, output retry orchestration or full integrated capacity claim.',requestedSeconds:seconds,elapsedMs:performance.now()-start,payloadBytes:size,sessions:10,generated:{deltas,outputs,admissions},completedCommands,simulatedImmediateCommandCompletion:true,semanticTelemetryIncluded:true,admissionMs:stats(timings.admission),outputMs:stats(timings.output),failures,producerRefused,peakPending,peakTelemetryBytes,telemetry:writer.status(),loopMs:{p99:loop.percentile(99)/1e6,max:loop.max/1e6},rssBytes:{first:rss[0],last:rss.at(-1),max:Math.max(...rss)}};
 const json=JSON.stringify(result,null,2);if(values.output)writeFileSync(values.output,json+'\n');console.log(json);
}finally{await writer.dispose();await storage.close();store.close();rmSync(root,{recursive:true,force:true});}
