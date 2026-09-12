// Child-process fixture: real HTTP, router, dispatcher, worker admission and output ingest.
// Only the external model is deterministic. No provider/tool/network side effects.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

process.once('message', async config => {
 process.env.PIBO_HOME = config.home;
 process.env.PIBO_TELEMETRY_PROVIDER_EVENTS = 'aggregate';
 mkdirSync(config.home,{recursive:true});
 const {PiboDataStore}=await import('../dist/data/pibo-store.js');
 const {PiboDataSessionStore}=await import('../dist/sessions/pibo-data-store.js');
 const {ChatRoomService}=await import('../dist/apps/chat/data/room-service.js');
 const {createFakeAgentRuntimeDriver}=await import('../dist/agent-runtime/testing/fake-adapter.js');
 const {InitialSessionContextBuilder}=await import('../dist/core/profiles.js');
 const {PiboSessionRouter}=await import('../dist/core/session-router.js');
 const {PiboPluginRegistry,definePiboPlugin}=await import('../dist/plugins/registry.js');
 const {piboCorePlugin}=await import('../dist/plugins/builtin.js');
 const {createWebHostChannel}=await import('../dist/web/channel.js');
 const {createChatWebApp}=await import('../dist/apps/chat/web-app.js');
 const dataPath=join(config.home,'pibo.sqlite');
 const data=new PiboDataStore(dataPath);
 const sessions=new PiboDataSessionStore(data);
 const room=new ChatRoomService(data).ensureDefaultRoom();
 let effectCount=0, pendingEffects=0;
 const driver=createFakeAgentRuntimeDriver({adapterId:'latency-deterministic',script(input,promptIndex){
  if(promptIndex===0)return {}; // Adapter openSession probes the script; not a model execution.
  // Bound fixture bookkeeping independently from the product's buffers.
  if(++effectCount>config.maxCommands || pendingEffects>=64) throw new Error('fixture effect/IPC budget exceeded');
  pendingEffects++;
  process.send?.({type:'effect',text:input.text},()=>{pendingEffects--;});
  // The testing adapter records prompts by default; exclude that test-only
  // retention in BOTH sampler modes, independent of product memory behavior.
  queueMicrotask(()=>{for(const runtime of registry.requireAgentRuntimeAdapter('latency-deterministic').sessions)runtime.prompts.length=0;});
  const count=Number(input.text.split(':')[2])%4===0 ? config.burst : 1;
  const text=`ack:${input.text}`;
  return {events:[...Array.from({length:count},(_,i)=>({type:'assistant_delta',text:text.slice(Math.floor(i*text.length/count),Math.floor((i+1)*text.length/count))})),{type:'assistant_message',text} ]};
 }});
 const registry=PiboPluginRegistry.create({plugins:[piboCorePlugin,definePiboPlugin({id:'latency.fixture',register(api){
  api.registerAgentRuntimeDriver(driver);
  api.registerAgentRuntimeInstance({id:'latency-deterministic',adapterId:'latency-deterministic'});
  for(let i=0;i<config.runtimes;i++){
   api.registerProfile({name:`latency-${i}`,create:()=>new InitialSessionContextBuilder(`latency-${i}`).withAgentRuntime('latency-deterministic').withBuiltinTools('disabled').withAutoContextFiles(false).withToolPackages({goalControl:false}).createSession()});
  }
 }})]});
 const seedStart=performance.now();
 for(let i=0;i<config.sessions;i++) sessions.create({id:`ps_latency_${i}`,channel:'web',kind:i>=6&&i<18?'subagent':'chat',profile:`latency-${i%config.runtimes}`,workspace:config.home,
  ...(i>=6&&i<18?{parentId:`ps_latency_${(i-6)%6}`} : {}),
  metadata:{chatRoomId:room.id},runtimeBinding:{runtimeInstanceId:'latency-deterministic',adapterId:'latency-deterministic',state:'unbound'}});
 const router=new PiboSessionRouter({persistSession:false,pluginRegistry:registry,sessionStore:sessions,cwd:config.home,routedSessionIdleTimeoutMs:false});
 const app=createChatWebApp({dataStorePath:dataPath,agentStorePath:join(config.home,'agents.sqlite'),reliabilityStorePath:join(config.home,'pibo-events.sqlite'),workflowStorePath:join(config.home,'workflows.sqlite'),dataPayloadRootDir:join(config.home,'payloads')});
 const channel=createWebHostChannel({port:0,host:'127.0.0.1',announce:false});
 const auth={name:'isolated-fixture-auth',async getSession(headers){return headers.get('x-latency-fixture')===config.token?{identity:{userId:'latency-fixture',provider:'fixture'}}:undefined;},async requireSession(headers){const session=await this.getSession(headers);if(!session)throw new Error('Unauthenticated fixture');return session;}};
 const context={auth,getSession:id=>sessions.get(id),createSession:input=>sessions.create(input),updateSession:(id,input)=>sessions.update(id,input),findSessions:input=>sessions.find(input),listSessions:()=>sessions.list(),getWebApps:()=>[app],getGatewayActions:()=>[],getProfiles:()=>Array.from({length:config.runtimes},(_,i)=>({name:`latency-${i}`,description:'deterministic fixture',aliases:[]})),getCapabilityCatalog:()=>({nativeTools:[],skills:[],subagents:[],contextFiles:[],packages:[],piboTools:[],mcpServers:[]})};
 for(const name of ['emit','subscribe','getSessionRuntimeBinding','getSessionRuntimeProfile','getSessionStatusSnapshot','listSessionRuntimeStatuses','listRuns','snapshotSignalSession','snapshotSignalTree','snapshotSignalStatuses','subscribeSignalTree','subscribeSignalStatuses','getRuntimeCapacityStatus']) context[name]=router[name].bind(router);
 const emit=context.emit;
 context.emit=async event=>{try{return await emit(event);}catch(error){console.error('fixture router error',error.stack);throw error;}};
 const loop=monitorEventLoopDelay({resolution:20});if(config.sampler==='on')loop.enable();
 await channel.start(context);
 let stopped=false;
 async function stop(){if(stopped)return;stopped=true;loop.disable();await channel.stop();await app.dispose?.();await router.disposeAll();data.close();process.disconnect?.();}
 process.on('message',async message=>{
  try {
   if(message.action==='sample'){
    process.send?.({id:message.id,result:{memory:process.memoryUsage(),eventLoopP95Ms:config.sampler==='on'?loop.percentile(95)/1e6:null,eventLoopMaxMs:config.sampler==='on'?loop.max/1e6:null,epoch:process.pid,monotonicMs:performance.now()}});loop.reset();
   }
   if(message.action==='integrity'){
    await app.drain?.();
    const rows=data.db.prepare(`WITH output_counts AS (
      SELECT session_id,event_id,SUM(type='message_finished') AS terminals,SUM(type='assistant_message') AS outputs
      FROM event_log WHERE type IN ('message_finished','assistant_message') GROUP BY session_id,event_id
     ) SELECT c.id,c.event_id AS eventId,c.session_id AS sessionId,c.state,
      CASE WHEN a.session_id=c.session_id AND json_extract(a.attributes_json,'$.clientTxnId')=c.event_id AND a.type='user.message.accepted' THEN 1 ELSE 0 END AS admissions,
      COALESCE(o.terminals,0) AS terminals,COALESCE(o.outputs,0) AS outputs
      FROM message_commands c LEFT JOIN event_log a ON a.stream_id=c.stream_id
      LEFT JOIN output_counts o ON o.session_id=c.session_id AND o.event_id=c.event_id ORDER BY c.id`).all();
    const collisions=data.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE type='pibo.output.identity_collision'").get().n;
    const reliability=new DatabaseSync(join(config.home,'pibo-events.sqlite'),{readOnly:true});
    let pendingOutputJobs,deadOutputJobs;
    try{pendingOutputJobs=reliability.prepare("SELECT COUNT(*) AS n FROM pibo_jobs WHERE queue IN ('output-persistence','output-persistence-cli')").get().n;deadOutputJobs=reliability.prepare("SELECT COUNT(*) AS n FROM pibo_dead_jobs WHERE queue IN ('output-persistence','output-persistence-cli')").get().n;}finally{reliability.close();}
    process.send?.({id:message.id,result:{commands:rows,collisions,pendingOutputJobs,deadOutputJobs,storage:await app.gatewayStatus?.(),capacity:router.getRuntimeCapacityStatus(),storedSessions:data.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n}});
   }
   if(message.action==='stop') {process.send?.({id:message.id,result:{stopping:true}});await stop();}
  }catch(error){process.send?.({id:message.id,error:error.message});}
 });
 process.once('SIGTERM',()=>{void stop();});
 const address=channel.getAddress();
 process.send?.({type:'ready',baseURL:`http://${address.host}:${address.port}`,roomId:room.id,seedMs:performance.now()-seedStart,pid:process.pid});
});
process.on('uncaughtException',error=>{process.send?.({type:'error',error:error.message});process.exitCode=1;process.disconnect?.();});
