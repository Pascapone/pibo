#!/usr/bin/env node
import { fork, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { cpus, totalmem, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export function distribution(values) {
 if(!values.length)return {n:0,median:null,p95:null,p99:null,max:null};
 const sorted=[...values].sort((a,b)=>a-b);const q=p=>sorted[Math.ceil(p*sorted.length)-1];
 return {n:sorted.length,median:q(.5),p95:q(.95),p99:sorted.length>=1000?q(.99):null,max:sorted.at(-1)};
}
export function verifyCommandIntegrity(accepted, result) {
 const rows=new Map(result.commands.map(row=>[row.id,row])); const effects=new Map(result.effects);
 const errors=[]; const seen=new Set();
 for(const command of accepted){
  if(seen.has(command.id)){errors.push({id:command.id,reason:'duplicate receipt identity across distinct commands'});continue;}seen.add(command.id);
  const row=rows.get(command.id);
  if(!row){errors.push({id:command.id,reason:'accepted command missing'});continue;}
  if(row.eventId!==command.eventId||row.sessionId!==command.sessionId)errors.push({id:command.id,reason:'correlation mismatch'});
  if(row.state!=='completed'||row.admissions!==1||row.terminals!==1||row.outputs!==1)errors.push({id:command.id,reason:'nonterminal or nonunique durable evidence',state:row.state,admissions:row.admissions,terminals:row.terminals,outputs:row.outputs});
  if(effects.get(command.text)!==1)errors.push({id:command.id,reason:'deterministic model effect missing or duplicated',effects:effects.get(command.text)??0});
 }
 for(const row of result.commands)if(!seen.has(row.id))errors.push({id:row.id,reason:'untracked durable command'});
 const expectedEffects=new Set(accepted.map(command=>command.text));
 for(const [text] of effects)if(!expectedEffects.has(text))errors.push({reason:'untracked model effect'});
 if(result.collisions!==0)errors.push({reason:'identity collisions',count:result.collisions});
 if(result.pendingOutputJobs!==0||result.deadOutputJobs!==0)errors.push({reason:'output persistence did not drain',pending:result.pendingOutputJobs??null,dead:result.deadOutputJobs??null});
 return {accepted:accepted.length,tracked:rows.size,errors,passed:errors.length===0};
}
function integer(flags,name,fallback,min,max){const n=Number(flags[name]??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${name}: expected ${min}..${max}`);return n;}
export function parseArgs(args){
 if(args.includes('--help'))return null;
 const flags={};const allowed=new Set(['--sessions','--samples','--pairs','--runtimes','--concurrency','--burst','--soak-seconds','--interval-ms','--max-commands','--sampler','--out','--request-timeout-ms','--drain-timeout-ms','--candidate']);
 for(let i=0;i<args.length;i++){if(args[i]==='--enforce'){flags.enforce=true;continue;}if(!allowed.has(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown/missing argument ${args[i]}`);flags[args[i]]=args[++i];}
 const sessions=(flags['--sessions']??'3250,10000').split(',').map(x=>integer({'n':x},'n',3250,20,100000));
 const samples=integer(flags,'--samples',1000,1,100000),maxCommands=integer(flags,'--max-commands',100000,20,100000);
 if(samples+20>maxCommands)throw new Error('max-commands must cover samples plus warmup');
 const sampler=flags['--sampler']??'on';if(!['on','off'].includes(sampler))throw new Error('sampler must be on or off');
 return {candidate:flags['--candidate']??process.env.PIBO_LATENCY_CANDIDATE??null,sessions,samples,pairs:integer(flags,'--pairs',30,1,1000),runtimes:integer(flags,'--runtimes',20,1,20),concurrency:integer(flags,'--concurrency',4,1,20),burst:integer(flags,'--burst',32,1,1000),soakSeconds:integer(flags,'--soak-seconds',0,0,10800),intervalMs:integer(flags,'--interval-ms',500,10,60000),requestTimeoutMs:integer(flags,'--request-timeout-ms',10000,100,120000),drainTimeoutMs:integer(flags,'--drain-timeout-ms',30000,100,120000),maxCommands,sampler,enforce:Boolean(flags.enforce),out:resolve(flags['--out']??`/tmp/latency-${Date.now()}`)};
}

async function runProfile(config, sessionCount){
 const directory=join(config.out,`sessions-${sessionCount}`);mkdirSync(directory,{recursive:true,mode:0o700});
 const token=randomUUID();let id=0;const pending=new Map();const effects=new Map();let exited=false;
 const child=fork(fileURLToPath(new URL('./latency-fixture-server.mjs',import.meta.url)),[],{stdio:['ignore','ignore','pipe','ipc']});
 let artifactBytes=0;
 const record=(name,value)=>{const line=JSON.stringify(value)+'\n';artifactBytes+=Buffer.byteLength(line);if(artifactBytes>256*1024*1024)throw new Error('artifact byte budget exceeded');appendFileSync(join(directory,name),line,{mode:0o600});};
 child.stderr.on('data',chunk=>{artifactBytes+=chunk.length;if(artifactBytes>256*1024*1024){child.kill('SIGKILL');return;}appendFileSync(join(directory,'server.log'),chunk,{mode:0o600});});
 child.on('exit',()=>{exited=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('fixture exited'));}pending.clear();});
 child.on('message',message=>{if(message.type==='effect'){if(effects.size>=config.maxCommands&&!effects.has(message.text)){child.kill('SIGKILL');return;}effects.set(message.text,(effects.get(message.text)??0)+1);record('effects.jsonl',{text:message.text});return;}const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new Error(message.error)):item.resolve(message.result);}});
 const rpc=action=>new Promise((resolveResult,reject)=>{if(exited)return reject(new Error('fixture exited'));const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`fixture ${action} timed out`));},config.drainTimeoutMs);pending.set(key,{resolve:resolveResult,reject,timer});child.send({action,id:key});});
 try {
  const ready=await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture startup timeout')),120000);child.once('error',reject);const listener=message=>{if(message.type==='ready'||message.type==='error'){clearTimeout(timer);child.removeListener('message',listener);message.type==='error'?reject(new Error(message.error)):resolveReady(message);}};child.on('message',listener);child.send({...config,sessions:sessionCount,home:join(directory,'home'),token});});
  const accepted=[],admission=[],pairs=[];let sequence=0;let duplicateRetries=0;
  const http=async(path,body)=>{const start=performance.now();const response=await fetch(ready.baseURL+path,{method:body?'POST':'GET',headers:{'x-latency-fixture':token,'origin':ready.baseURL,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(config.requestTimeoutMs)});const value=await response.json();return {status:response.status,value,ms:performance.now()-start,serverTiming:response.headers.get('server-timing')};};
  async function send(measure=true){
   const index=sequence++,eventId=`latency-${sessionCount}-${index}`,sessionId=`ps_latency_${index%config.runtimes}`,text=`latency:${sessionCount}:${index}`;
   const body={admissionVersion:2,piboSessionId:sessionId,clientTxnId:eventId,text};
   const response=await http('/api/chat/message',body);
   if(response.status!==202||!response.value.receipt?.id)throw new Error(`Admission failed (${response.status}): ${JSON.stringify(response.value)}`);
   const command={id:response.value.receipt.id,eventId,sessionId,text};accepted.push(command);
   record('admission.jsonl',{...command,ms:response.ms,serverTiming:response.serverTiming,measure});if(measure)admission.push(response.ms);
   if(index%17===0){const retry=await http('/api/chat/message',body);if(retry.status!==202||retry.value.receipt?.id!==command.id||!retry.value.duplicate)throw new Error('idempotent HTTP retry failed');duplicateRetries++;}
   return command;
  }
  async function drain(commands){
   const deadline=performance.now()+config.drainTimeoutMs;const unresolved=new Map(commands.map(c=>[c.id,c]));
   while(unresolved.size){
    if(performance.now()>=deadline)throw new Error(`Drain timed out: ${[...unresolved.keys()].slice(0,20).join(',')}`);
    for(const [id] of unresolved){const result=await http(`/api/chat/message-receipts/${encodeURIComponent(id)}`);if(result.status!==200)throw new Error(`Receipt read ${result.status}`);const state=result.value.receipt?.state;if(state==='completed')unresolved.delete(id);else if(['failed','interrupted','cancelled'].includes(state))throw new Error(`Command ${id} terminal ${state}`);}
    if(unresolved.size)await delay(10);
   }
  }
  for(let i=0;i<config.runtimes;i++)await drain([await send(false)]);
  const before=await rpc('sample');record('samples.jsonl',{phase:'before',...before});
  // Paired control measurements: health-alone baseline immediately precedes
  // concurrently issued status/health requests from this independent process.
  for(let i=0;i<config.pairs;i++){
   const baseline=await http('/health');const [status,health]=await Promise.all([http('/gateway/status'),http('/health')]);
   if(status.status!==200||health.status!==200||baseline.status!==200)throw new Error('paired status/health HTTP failure');
   const pair={index:i,statusMs:status.ms,healthMs:health.ms,baselineHealthMs:baseline.ms,extraHealthMs:Math.max(0,health.ms-baseline.ms),activeRuntimes:status.value.runtimeStatuses?.length??null};
   pairs.push(pair);record('status-health.jsonl',pair);
  }
  for(let i=0;i<config.samples;i+=config.concurrency){const batch=await Promise.all(Array.from({length:Math.min(config.concurrency,config.samples-i)},()=>send()));await drain(batch);if(config.sampler==='on'){const sample=await rpc('sample');record('samples.jsonl',{phase:'admission',...sample});}}
  const soakStart=performance.now();let soakCommands=0;let capped=false;
  while(performance.now()-soakStart<config.soakSeconds*1000){
   if(sequence+config.concurrency>config.maxCommands){capped=true;break;}
   const batch=await Promise.all(Array.from({length:config.concurrency},()=>send(false)));soakCommands+=batch.length;await drain(batch);
   if(config.sampler==='on')record('samples.jsonl',{phase:'soak',...await rpc('sample')});
   await delay(Math.min(config.intervalMs,Math.max(0,config.soakSeconds*1000-(performance.now()-soakStart))));
  }
  await drain(accepted.slice(-config.concurrency));
  const integrityRaw=await rpc('integrity');const integrity=verifyCommandIntegrity(accepted,{...integrityRaw,effects:[...effects]});record('integrity.jsonl',{...integrity,commands:integrityRaw.commands});
  await delay(200);const after=await rpc('sample');record('samples.jsonl',{phase:'after-drain',...after});
  const timings=distribution(admission),status=distribution(pairs.map(x=>x.statusMs)),health=distribution(pairs.map(x=>x.extraHealthMs));
  const failures=[];if(timings.p95>200)failures.push('admission p95 > 200ms');if(timings.p99!==null&&timings.p99>500)failures.push('admission p99 > 500ms');if(status.p95>100)failures.push('status p95 > 100ms');if(health.max>50)failures.push('paired health additional delay > 50ms');if(!integrity.passed)failures.push('command integrity');if(capped)failures.push('soak stopped at command cap');
  const incomplete=[];if(sessionCount<3250)incomplete.push('reference requires at least 3250 sessions');if(config.runtimes!==20)incomplete.push('20-runtime reference not sampled');if(config.samples<1000)incomplete.push('p99 requires 1000 admission samples');if(config.pairs<30)incomplete.push('status/health requires 30 pairs');if(pairs.some(p=>p.activeRuntimes!==config.runtimes))incomplete.push('runtime population not established');
  const result={sessions:sessionCount,runtimes:config.runtimes,seedMs:ready.seedMs,admission:timings,status,healthAdditional:health,integrity,duplicateRetries,soak:{requestedSeconds:config.soakSeconds,actualSeconds:(performance.now()-soakStart)/1000,commands:soakCommands,capped},memory:{before,after},failures,incomplete,passed:failures.length===0&&incomplete.length===0,
   instrumentation:{clock:'process-local performance.now; no cross-process timestamp subtraction',serverTiming:'actual HTTP Server-Timing',storagePhases:'see integrated storage-worker status; not available in baseline sampler',sessionColdstartProviderWait:'not inferred from HTTP; runtime-capacity evidence retained',capacity:integrityRaw.capacity,storage:integrityRaw.storage},
   acceptanceBoundary:'Deterministic product-path local profile only. Browser resume, real delegation/provider load, 2h trend analysis, remote and sampler A/B acceptance are separate; no claim of full AP10 acceptance.'};
  writeFileSync(join(directory,'summary.json'),JSON.stringify(result,null,2),{mode:0o600});return result;
 } finally {
  if(!exited){try{await rpc('stop');}catch{} }
  if(!exited)await new Promise(resolveExit=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolveExit();});});
 }
}

export async function main(args=process.argv.slice(2)){
 const config=parseArgs(args);
 if(!config){console.log(`Local latency integration harness (Docker only)
Usage: node scripts/latency-harness.mjs [--sessions 3250,10000] [--samples 1000] [--pairs 30]
  [--runtimes 20] [--concurrency 4] [--burst 32] [--soak-seconds 7200]
  [--interval-ms 500] [--max-commands 100000] [--sampler on|off] [--out /tmp/evidence] [--enforce]
  [--request-timeout-ms 10000] [--drain-timeout-ms 30000] [--candidate <40-char SHA>]
Default: finite admission/profile run, no soak. --enforce exits nonzero for failed/insufficient gates.
External model is deterministic; HTTP/dispatcher/router/worker/output/receipts are real product paths.
Compare sampler on/off in separate identical runs; no global status polling in admission/soak.
Two-hour and remote/provider/browser acceptance is not implied by a local smoke.`);return;}
 if(!existsSync('/.dockerenv'))throw new Error('Local fixture must run inside an isolated Docker worker');
 if(existsSync(config.out))throw new Error('Evidence directory already exists; choose a new --out path');
 mkdirSync(config.out,{recursive:true,mode:0o700});
 const startedAt=new Date().toISOString();
 const git=args=>{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{return null;}};
 const commit=config.candidate??git(['rev-parse','HEAD']);if(!commit||!/^[a-f0-9]{40}$/.test(commit))throw new Error('Supply --candidate <40-char SHA> when the Docker mount has no Git metadata');
 const metadata={startedAt,config,commit,dirty:git(['status','--porcelain']),node:process.version,hardware:{platform:platform(),arch:arch(),cpus:cpus().length,model:cpus()[0]?.model,totalmem:totalmem(),cgroupMemory:existsSync('/sys/fs/cgroup/memory.max')?readFileSync('/sys/fs/cgroup/memory.max','utf8').trim():null},sources:['scripts/latency-harness.mjs','scripts/latency-fixture-server.mjs','dist/core/session-router.js','dist/data/chat-storage-worker.js','dist/data/async-chat-storage.js','dist/data/bounded-worker-client.js','dist/apps/chat/message-command-dispatcher.js','dist/apps/chat/web-app.js','dist/web/channel.js'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
 const results=[];
 try{for(const sessions of config.sessions)results.push(await runProfile(config,sessions));}
 finally{writeFileSync(join(config.out,'run.json'),JSON.stringify({...metadata,finishedAt:new Date().toISOString(),results},null,2),{mode:0o600});}
 console.log(JSON.stringify({artifact:join(config.out,'run.json'),profiles:results.map(r=>({sessions:r.sessions,passed:r.passed,failures:r.failures,incomplete:r.incomplete,admission:r.admission,status:r.status,integrity:r.integrity.passed}))},null,2));
 if(config.enforce&&results.some(r=>!r.passed))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack);process.exitCode=1;});
