import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { PiboSessionRouter } from '../dist/core/session-router.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
const {values}=parseArgs({options:{help:{type:'boolean'},sessions:{type:'string',default:'20'},cycles:{type:'string',default:'3'},limit:{type:'string',default:'8'},output:{type:'string'}}});
if(values.help){console.log('Isolated real-Pi runtime activation/idle-eviction benchmark. No model requests.\n--sessions <1..20> --cycles <1..10> --limit <1..32> --output <json>\nUses empty native histories and a private temporary workspace; run only in an isolated worker.');process.exit(0);}
const count=Number(values.sessions),cycles=Number(values.cycles),limit=Number(values.limit);
for(const [n,max] of [[count,20],[cycles,10],[limit,32]])if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error('Invalid bounded benchmark option');
const root=mkdtempSync(join(tmpdir(),'pibo-runtime-capacity-'));const store=new InMemoryPiboSessionStore();
const router=new PiboSessionRouter({persistSession:false,sessionStore:store,cwd:root,routedSessionIdleTimeoutMs:false,runtimeCapacity:{maxRuntimes:limit}});
const loop=monitorEventLoopDelay({resolution:10});const samples=[];const started=performance.now();loop.enable();
try {
 for(let cycle=0;cycle<cycles;cycle++)for(let i=0;i<count;i++){
  const session=store.create({channel:'benchmark',kind:'chat',profile:'base',workspace:root,metadata:{chatRoomId:i%2?'quiet':'large'}});
  const start=performance.now();const status=await router.emit({type:'execution',piboSessionId:session.id,action:'status'});
  if(status.type!=='execution_result')throw new Error('No real runtime status');
  const capacity=router.getRuntimeCapacityStatus();if(capacity.activeRuntimes>limit)throw new Error('Runtime pool exceeded limit');
  samples.push({cycle,index:i,initializationMs:performance.now()-start,rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed,activeRuntimes:capacity.activeRuntimes});
  await yieldLoop();
 }
 loop.disable();
 const result={at:new Date().toISOString(),node:process.version,scope:'Real Pi SDK activation with empty native histories, no provider calls, sequential Session rotation and no forced GC. This is not a concurrent streaming or full-history memory profile.',sessionsPerCycle:count,cycles,limit,elapsedMs:performance.now()-started,samples,eventLoopMs:{p99:loop.percentile(99)/1e6,max:loop.max/1e6},capacity:router.getRuntimeCapacityStatus()};
 await router.disposeAll();result.afterDispose=router.getRuntimeCapacityStatus();
 const json=JSON.stringify(result,null,2);if(values.output)writeFileSync(values.output,json+'\n');console.log(json);
}finally{await router.disposeAll();rmSync(root,{recursive:true,force:true});}
