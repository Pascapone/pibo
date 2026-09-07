import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {AsyncChatReadQueries} from '../dist/data/async-chat-reads.js';
import {AsyncChatStorage} from '../dist/data/async-chat-storage.js';
import {ChatSessionQueryService} from '../dist/apps/chat/data/session-query-service.js';
import {ChatRoomService} from '../dist/apps/chat/data/room-service.js';
import {InMemoryPiboSessionStore} from '../dist/sessions/store.js';
const {values}=parseArgs({options:{help:{type:'boolean'},keep:{type:'boolean'},'fast-seed':{type:'boolean'},reuse:{type:'string'},events:{type:'string',default:'1000000'},sessions:{type:'string',default:'1000'},samples:{type:'string',default:'500'},output:{type:'string'}}});
if(values.help){console.log('Owned synthetic read-worker / concurrent admission benchmark. --events <0..10000000> --sessions <10..10000> --samples <1..10000> --output <json> --keep --fast-seed --reuse <owned-fixture-dir>. Failed fixtures are retained. Docker or owned Pibo2 slot only. No HTTP/provider/browser or sustained-rate claim.');process.exit(0);}
const count=Number(values.events),width=Number(values.sessions),samples=Number(values.samples);
for(const [n,min,max] of [[count,0,10000000],[width,10,10000],[samples,1,10000]])if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid bounded benchmark options');
const root=values.reuse?resolve(values.reuse):mkdtempSync(join(tmpdir(),'pibo-read-bench-')),payloadRootDir=join(root,'payloads');
const saved=values.reuse?JSON.parse(readFileSync(join(root,'benchmark-fixture.json'),'utf8')):undefined;
if(saved&&(saved.kind!=='pibo-read-benchmark-v1'||saved.events!==count||saved.width!==width))throw Error('Not the requested owned benchmark fixture');
let failed=true,stage='seed';
const store=new PiboDataStore(join(root,'data.sqlite'),{payloadRootDir});let reader,writer;
const stats=a=>{a=[...a].sort((x,y)=>x-y);return {samples:a.length,p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1],max:a.at(-1)};};
try{
 let room,targets;
 if(saved){room=saved.room;targets=saved.targets;}else{
 room=new ChatRoomService(store).createRoom({name:'Synthetic read benchmark',type:'chat'});
 const sessions=new InMemoryPiboSessionStore(),index=new ChatSessionQueryService(store);
 targets=Array.from({length:width},()=>sessions.create({channel:'benchmark',kind:'chat',profile:'base',metadata:{chatRoomId:room.id}}));
 store.transaction(()=>targets.forEach(s=>index.upsertSession(s)));
 const event=store.db.prepare("INSERT INTO event_log(room_id,session_id,session_sequence,topic,type,source,idempotency_key,retention_class,attributes_json,created_at) VALUES(?,?,?,'pibo.output',?,'benchmark',?,?,?,'2026-09-07T00:00:00Z')");
 const attrs=JSON.stringify({text:'Synthetic historical output',toolName:'read',summary:'Synthetic tool result'});
 const seedStarted=performance.now();
 if(values['fast-seed']){
  const definitions=store.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='event_log' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  for(const row of definitions)store.db.exec(`DROP ${row.type.toUpperCase()} "${row.name}"`);
  store.db.exec('CREATE TEMP TABLE seed_sessions(position INTEGER PRIMARY KEY,id TEXT NOT NULL)');const seedSession=store.db.prepare('INSERT INTO seed_sessions VALUES(?,?)');targets.slice(0,10).forEach((s,i)=>seedSession.run(i,s.id));
  const bulk=store.db.prepare(`WITH RECURSIVE rows(n) AS (SELECT ? UNION ALL SELECT n+1 FROM rows WHERE n+1<?)
   INSERT INTO event_log(room_id,session_id,session_sequence,topic,type,source,idempotency_key,retention_class,attributes_json,created_at)
   SELECT ?,s.id,n/10+1,'pibo.output',CASE WHEN (n/10+1)%10=0 THEN 'assistant_message' ELSE 'tool_execution_finished' END,'benchmark','history:'||n,CASE WHEN (n/10+1)%10=0 THEN 'chat_message' ELSE 'trace_event' END,?,'2026-09-07T00:00:00Z' FROM rows JOIN seed_sessions s ON s.position=n%10`);
  const messages=store.db.prepare(`INSERT INTO chat_messages(id,session_id,sequence,source_stream_id,role,status,created_at,content_preview,attributes_json)
   SELECT 'message:'||(stream_id-1),session_id,session_sequence,stream_id,'assistant','complete','2026-09-07','Synthetic historical output','{}' FROM event_log WHERE stream_id>? AND stream_id<=? AND type='assistant_message'`);
  for(let offset=0;offset<count;offset+=10000){store.transaction(()=>{bulk.run(offset,Math.min(count,offset+10000),room.id,attrs);messages.run(offset,Math.min(count,offset+10000));});if(offset%1000000===0)console.error(`Bulk fixture rows: ${Math.min(count,offset+10000)}`);}
  for(const row of definitions){store.db.exec(row.sql);console.error(`Restored fixture ${row.name}`);}
  store.db.exec("INSERT INTO chat_trace_revisions SELECT session_id,COUNT(*) FROM event_log GROUP BY session_id; INSERT INTO chat_unread_index SELECT stream_id,session_id FROM event_log WHERE retention_class='chat_message' AND type='assistant_message';DROP TABLE seed_sessions");
 }else{
 for(let offset=0;offset<count;offset+=1000)store.transaction(()=>{for(let i=offset;i<Math.min(count,offset+1000);i++){
  const session=targets[i%10],seq=Math.floor(i/10)+1,semantic=seq%10===0;
  const id=Number(event.run(room.id,session.id,seq,semantic?'assistant_message':'tool_execution_finished',`history:${i}`,semantic?'chat_message':'trace_event',attrs).lastInsertRowid);
  if(semantic)store.messages.insertMessage({id:`message:${i}`,sessionId:session.id,sequence:seq,sourceStreamId:id,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'Synthetic historical output'});
 }});
 }

 console.error(`Seeded ${count} events / ${width} sessions in ${Math.round(performance.now()-seedStarted)}ms`);
 writeFileSync(join(root,'benchmark-fixture.json'),JSON.stringify({kind:'pibo-read-benchmark-v1',events:count,width,room,targets,fastSeed:Boolean(values['fast-seed'])}));
 }
 stage='startup';const startupStarted=performance.now();
 reader=new AsyncChatReadQueries(store.path,payloadRootDir);writer=new AsyncChatStorage(store.path,payloadRootDir,{maxAgeMs:2000});
 const readyDeadline=Date.now()+20000;while(!reader.status().ready||!writer.status().ready){if(reader.status().closed||writer.status().closed||Date.now()>readyDeadline)throw Error('Read benchmark worker startup failed');await new Promise(resolve=>setTimeout(resolve,10));}
 const startupMs=performance.now()-startupStarted;
 await reader.history.getProductHistoryCoverage(targets[0].id);await writer.resolveRoom(room.id,true);
 const readNavigation=async()=>{const items=[];let afterId;for(;;){const page=await reader.navigation.sessionIndexPage({roomId:room.id,afterId,limit:500});items.push(...page);if(page.length<500)break;afterId=page.at(-1).piboSessionId;}if(items.length!==width)throw Error('Navigation lost sessions');return items;};
 const readUnread=async()=>{const result=await reader.navigation.unreadCountsPage({piboSessionIds:targets.map(s=>s.id)});if(count>=100&&result.length<10)throw Error('Unread fixture coverage incomplete');return result;};
 stage='measurement';
 const timings={},errors={},sizes={},loop=monitorEventLoopDelay({resolution:10});let accepted=0,completed=0;
 const measure=async(name,fn)=>{const start=performance.now();try{const value=await fn();(timings[name]??=[]).push(performance.now()-start);sizes[name]=Math.max(sizes[name]??0,Buffer.byteLength(JSON.stringify(value)??''));return value;}catch(error){errors[name+':'+(error.code??error.message)]=(errors[name+':'+(error.code??error.message)]??0)+1;}};
 loop.enable();const started=performance.now(),rssStart=process.memoryUsage().rss;
 for(let i=0;i<samples;i++){
  const session=targets[i%10],piboSessionId=session.id;
  await Promise.all([
   measure('trace',()=>reader.timeline.listTraceEvents({piboSessionId,limit:100})),
   measure('history',()=>reader.history.listProductHistoryEntries({piboSessionId,limit:50})),
   measure('coverage',()=>reader.history.getProductHistoryCoverage(piboSessionId)),
   measure('timings',()=>reader.timeline.scanMessageTurnTimings(piboSessionId)),
   ...(i%10===0?[measure('navigationAllPages',readNavigation),measure('unread',readUnread)]:[]),
   measure('admission',async()=>{const key=`admit:${started}:${i}`;const result=await writer.admit({roomId:room.id,piboSessionId,eventType:'user.message.accepted',actorType:'user',actorId:'benchmark',clientTxnId:key,retentionClass:'chat_message',payload:{type:'user.message.accepted',text:'benchmark',clientTxnId:key}},session,'benchmark',{eventId:key,delivery:'queue'});accepted++;return {created:result.created};})
  ]);
  for(;;){const claim=await writer.claimCommand('benchmark',30000);if(!claim)break;if(!await writer.transitionCommand(claim.id,'benchmark',claim.token,'completed'))throw Error('Lost claim');completed++;}
 }
 loop.disable();if(accepted!==completed)throw Error('Acknowledged commands not completed');
 const result={at:new Date().toISOString(),scope:'Synthetic worker reads and concurrent durable admission with immediate fenced completion; no HTTP, browser, provider, sustained-rate or cold-cache claim.',fixture:{events:count,sessions:width,samples},startupMs,elapsedMs:performance.now()-started,accepted,completed,errors,timings:Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,stats(v)])),maximumJsonBytes:sizes,callerEventLoopMs:{p99:loop.percentile(99)/1e6,max:loop.max/1e6},rssBytes:{start:rssStart,end:process.memoryUsage().rss},reader:reader.status(),writer:writer.status()};
 const json=JSON.stringify(result,null,2);if(values.output)writeFileSync(values.output,json+'\n');console.log(json);failed=false;
}catch(error){const failure={stage,fixtureRoot:root,code:error.code,message:error.message,reader:reader?.status(),writer:writer?.status()};console.error(JSON.stringify(failure,null,2));if(values.output)writeFileSync(values.output,JSON.stringify({failure},null,2)+'\n');throw error;}finally{await reader?.close();await writer?.close();store.close();if(!failed&&!values.keep&&!values.reuse)rmSync(root,{recursive:true,force:true});else console.error(`Retained owned fixture: ${root}`);}
