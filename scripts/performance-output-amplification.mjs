import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {startWebOutboxProcessHost} from '../test/fixtures/web-outbox-process-harness.mjs';
const {values}=parseArgs({options:{help:{type:'boolean'},output:{type:'string'},'payload-bytes':{type:'string',default:'1024'}}});
if(values.help){console.log('Measure real Chat output outbox writes in a private fake-auth fixture.\nRun under --import ./scripts/performance-sql-observer.mjs with PIBO_SQL_MEASUREMENT_DIR.\n--payload-bytes <1..1048576> --output <json>\nOptional strace fsync/fdatasync timestamps can be correlated with phase windows. Instrumented latency includes observer overhead.');process.exit(0);}
const size=Number(values['payload-bytes']);if(!Number.isSafeInteger(size)||size<1||size>1048576)throw Error('Invalid payload size');
const directory=mkdtempSync(join(tmpdir(),'pibo-output-amplification-')),sid='ps_write_amplification',eventId='measured-turn';let host;
const readCounters=()=>Object.fromEntries(readdirSync(process.env.PIBO_SQL_MEASUREMENT_DIR).filter(n=>n.endsWith('.json')).map(n=>{const data=JSON.parse(readFileSync(join(process.env.PIBO_SQL_MEASUREMENT_DIR,n),'utf8'));return [String(data.threadId),data.counters];}));
const files=()=>Object.fromEntries(Object.values(host.paths).filter(p=>p.endsWith('.sqlite')).flatMap(path=>['','-wal'].map(suffix=>{try{return [basename(path)+suffix,statSync(path+suffix).size];}catch{return [basename(path)+suffix,0];}})));
const result={at:new Date().toISOString(),payloadBytes:size,scope:'Actual Chat Web output retry/claim/checkpoint/receipt path with a private synthetic session and fake authentication. No real model. SQL binding bytes are observed input bytes, not physical memory-copy counts. UPSERT statements classify as INSERT; changedRows are SQLite affected rows, not inserts alone. Instrumented CPU/elapsed time includes observer and syscall-tracing overhead. WAL bytes are file growth, not cumulative writes. No capacity SLO claim.',phases:[]};
try{
 host=await startWebOutboxProcessHost({directory,piboSessionId:sid});
 const init=await fetch(host.baseURL+'/api/chat/sessions',{headers:{'x-test-user':'user-1'}});if(!init.ok)throw Error('Fixture did not initialize');await host.app.drain?.();await delay(100);
 const text='x'.repeat(size);
 const events=[
  {type:'message_started',text:'synthetic prompt',source:'user'},
  {type:'assistant_delta',assistantIndex:0,contentIndex:0,text},
  {type:'assistant_message',assistantIndex:0,contentIndex:0,text},
  {type:'tool_call',toolCallId:'measured-tool',toolName:'benchmark',args:{input:'synthetic'},argsComplete:true},
  {type:'tool_execution_started',toolCallId:'measured-tool',toolName:'benchmark',args:{input:'synthetic'}},
  {type:'tool_execution_updated',toolCallId:'measured-tool',toolName:'benchmark',partialResult:{content:[{type:'text',text}]}},
  {type:'tool_execution_finished',toolCallId:'measured-tool',toolName:'benchmark',isError:false,result:{content:[{type:'text',text}]}},
  {type:'message_finished',source:'user'}
 ];
 for(const event of events){
  const before=readCounters(),filesBefore=files(),cpu=process.cpuUsage(),start=performance.now(),epochStartMs=Date.now();
  host.emitOutput({...event,piboSessionId:sid,eventId});await host.app.drain?.();await delay(30);
  result.phases.push({type:event.type,epochStartMs,epochEndMs:Date.now(),elapsedMs:performance.now()-start,cpuMicros:process.cpuUsage(cpu),before,after:readCounters(),filesBefore,filesAfter:files()});
 }
 const trace=await(await fetch(host.baseURL+'/api/chat/trace?piboSessionId='+sid,{headers:{'x-test-user':'user-1'}})).json();const flat=ns=>ns.flatMap(n=>[n,...flat(n.children??[])]);result.finalNodes=flat(trace.nodes??[]).map(n=>({type:n.type,status:n.status}));
 const json=JSON.stringify(result,null,2);if(values.output)writeFileSync(values.output,json+'\n');console.log(json);
}finally{await host?.channel.stop?.();await host?.app.dispose?.();rmSync(directory,{recursive:true,force:true});}
