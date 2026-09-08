import test from "node:test";
import { spawnSync, execFile } from "node:child_process";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AsyncChatStorage } from "../dist/data/async-chat-storage.js";
import { MessageCommandStore } from "../dist/data/message-command-store.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

test("durable commands commit with admission, deduplicate and reject changed payloads", async () => {
	const root=mkdtempSync(join(tmpdir(),"pibo-commands-"));
	const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
	const room=new ChatRoomService(store).ensureDefaultRoom();
	const session=new InMemoryPiboSessionStore().create({channel:"test",kind:"chat",profile:"base",metadata:{chatRoomId:room.id}});
	const storage=new AsyncChatStorage(store.path,join(root,"payloads"));
	const input={roomId:room.id,piboSessionId:session.id,eventType:"user.message.accepted",actorType:"user",actorId:"actor",clientTxnId:"txn",retentionClass:"chat_message",payload:{type:"user.message.accepted",text:"hello",clientTxnId:"txn"}};
	try {
		const results=await Promise.all(Array.from({length:10},()=>storage.admit(input,session,"hello",{eventId:"txn",delivery:"queue"})));
		assert.equal(results.filter(r=>r.created).length,1);
		assert.equal(new Set(results.map(r=>r.receipt.id)).size,1);
		const receipt=results[0].receipt;
		assert.equal(receipt.state,"accepted");
		assert.equal(store.db.prepare("SELECT status FROM session_navigation WHERE session_id=?").get(session.id).status,"idle");
		assert.equal(Number(store.db.prepare("SELECT count(*) n FROM message_commands").get().n),1);
		assert.equal(Number(store.db.prepare("SELECT count(*) n FROM event_log WHERE type='user.message.accepted'").get().n),1);
		await assert.rejects(storage.admit(input,session,"different",{eventId:"txn",delivery:"queue"}),{code:"command_conflict"});
		await assert.rejects(storage.admit(input,session,"hello",{eventId:"txn",delivery:"steer"}),{code:"command_conflict"});
		const claim=await storage.claimCommand("owner",30000);
		assert.equal(claim.id,receipt.id);
		assert.equal(claim.text,"hello");
		assert.equal(await storage.claimCommand("other",30000),undefined);
		assert.equal(await storage.transitionCommand(claim.id,"other",claim.token,"initializing"),false);
		assert.equal(await storage.transitionCommand(claim.id,"owner",claim.token,"initializing"),true);
		store.db.prepare("UPDATE message_commands SET lease_until=0 WHERE id=?").run(claim.id);
		assert.equal(await storage.claimCommand("restarted",30000),undefined);
		assert.equal((await storage.commandReceipt(claim.id)).state,"interrupted");
		assert.equal(await storage.heartbeatCommand(claim.id,"owner",claim.token,30000),false);
	} finally {await storage.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test("unstarted claims recover with a higher fence and session FIFO survives equal timestamps",()=>{
	const root=mkdtempSync(join(tmpdir(),"pibo-command-fifo-"));
	const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
	const commands=new MessageCommandStore(store);
	const add=(key,sessionId,streamId)=>{ const prepared=commands.prepare({sessionId,roomId:"room",text:key,delivery:"queue"});return store.transaction(()=>commands.insert({key,sessionId,roomId:"room",eventId:key,streamId,delivery:"queue",...prepared})); };
	try {
		const first=add("first","a",1);const second=add("second","a",2);const independent=add("third","b",3);
		store.db.prepare("UPDATE message_commands SET created_at=1").run();
		const claim=commands.claim("one",30000);assert.equal(claim.id,first.id);
		assert.equal(commands.claim("two",30000).id,independent.id);
		store.db.prepare("UPDATE message_commands SET lease_until=0 WHERE id=?").run(first.id);
		const recovered=commands.claim("three",30000);assert.equal(recovered.id,first.id);assert.ok(recovered.token>claim.token);
		assert.equal(commands.transition(first.id,"one",claim.token,"initializing"),false);
		commands.recordOutput("a","first","message_finished");
		assert.equal(commands.claim("three",30000).id,second.id);
		commands.recordOutput("a","second","message_started");commands.recordOutput("a","second","message_queued");
		assert.equal(commands.get(second.id).state,"running");
	} finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("overload rolls back acceptance and a retry keeps its transaction identity", async () => {
 const root=mkdtempSync(join(tmpdir(),"pibo-command-overload-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
 const room=new ChatRoomService(store).ensureDefaultRoom();
 const session=new InMemoryPiboSessionStore().create({channel:"test",kind:"chat",profile:"base",metadata:{chatRoomId:room.id}});
 const storage=new AsyncChatStorage(store.path,join(root,"payloads"));
 const admit=(id,text="hello")=>storage.admit({roomId:room.id,piboSessionId:session.id,eventType:"user.message.accepted",actorType:"user",actorId:"actor",clientTxnId:id,retentionClass:"chat_message",payload:{type:"user.message.accepted",text,clientTxnId:id}},session,text,{eventId:id,delivery:"queue"});
 try {
  for(let i=0;i<64;i++) await admit(`txn-${i}`);
  await assert.rejects(admit("overflow"),{code:"command_overloaded"});
  assert.equal(Number(store.db.prepare("SELECT count(*) n FROM event_log WHERE type='user.message.accepted'").get().n),64);
  assert.equal(Number(store.db.prepare("SELECT count(*) n FROM message_commands").get().n),64);
  const duplicate=await admit("txn-0");assert.equal(duplicate.created,false);
  new MessageCommandStore(store).recordOutput(session.id,"txn-0","message_finished");
  const retry=await admit("overflow");assert.equal(retry.created,true);assert.equal(retry.receipt.eventId,"overflow");
  await assert.rejects(admit("too-large","x".repeat(1024*1024+1)),{code:"command_too_large"});
  assert.equal(Number(store.db.prepare("SELECT count(*) n FROM message_commands").get().n),65);
 } finally {await storage.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test("steering bypasses an active normal turn but never becomes a queued turn",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-steer-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
 const commands=new MessageCommandStore(store);
 const add=(key,streamId,delivery)=>{const prepared=commands.prepare({sessionId:"a",roomId:"room",text:key,delivery});return store.transaction(()=>commands.insert({key,sessionId:"a",roomId:"room",eventId:key,streamId,delivery,...prepared}));};
 try {
  const first=add("normal",1,"queue");add("next-normal",2,"queue");
  assert.equal(commands.claim("one",30000).id,first.id);
  const steer=add("steer",3,"steer");
  commands.recordOutput("a","normal","message_started");
  const claimed=commands.claim("two",30000);assert.equal(claimed.id,steer.id);assert.equal(claimed.delivery,"steer");
  commands.recordOutput("a","steer","message_steered");assert.equal(commands.get(steer.id).state,"completed");
  assert.equal(commands.claim("three",30000),undefined);
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("process death preserves committed commands and fences uncertain dispatch",()=>{
 for(const boundary of ["before_commit","after_commit","claimed","dispatched"]) {
  const root=mkdtempSync(join(tmpdir(),"pibo-command-crash-"));
  const script=`
   import { PiboDataStore } from './dist/data/pibo-store.js';
   import { MessageCommandStore } from './dist/data/message-command-store.js';
   const store=new PiboDataStore(process.argv[1]+'/data.sqlite',{payloadRootDir:process.argv[1]+'/payloads'});
   const commands=new MessageCommandStore(store);
   const prepared=commands.prepare({sessionId:'session',roomId:'room',text:'durable',delivery:'queue'});
   store.transaction(()=>{commands.insert({key:'key',sessionId:'session',roomId:'room',eventId:'event',streamId:1,delivery:'queue',...prepared});if(process.argv[2]==='before_commit') process.exit(23);});
   if(process.argv[2]==='claimed'||process.argv[2]==='dispatched') {const claim=commands.claim('dead',30000);if(process.argv[2]==='dispatched')commands.transition(claim.id,'dead',claim.token,'initializing');}
   process.exit(23);
  `;
  try {
   const child=spawnSync(process.execPath,["--input-type=module","-e",script,root,boundary],{encoding:"utf8"});assert.equal(child.status,23,child.stderr);
   const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
   try {
    const commands=new MessageCommandStore(store);const saved=commands.find("key");
    if(boundary==="before_commit"){assert.equal(saved,undefined);continue;}
    assert.ok(saved);store.db.prepare("UPDATE message_commands SET lease_until=0").run();
    const resumed=commands.claim("new",30000);
    if(boundary==="dispatched") {assert.equal(resumed,undefined);assert.equal(commands.get(saved.id).state,"interrupted");commands.recordOutput("session","event","message_finished");assert.equal(commands.get(saved.id).state,"completed");}
    else {assert.equal(resumed.id,saved.id);assert.equal(resumed.text,"durable");}
   } finally {store.close();}
  } finally {rmSync(root,{recursive:true,force:true});}
 }
});


test("independent dispatcher processes claim one committed command only once",async()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-owners-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
 const commands=new MessageCommandStore(store);
 const prepared=commands.prepare({sessionId:"s",roomId:"r",text:"one",delivery:"queue"});
 const saved=store.transaction(()=>commands.insert({key:"k",sessionId:"s",roomId:"r",eventId:"e",streamId:1,delivery:"queue",...prepared}));
 store.close();
 const script=`import {PiboDataStore} from './dist/data/pibo-store.js';import {MessageCommandStore} from './dist/data/message-command-store.js';const s=new PiboDataStore(process.argv[1]+'/data.sqlite',{payloadRootDir:process.argv[1]+'/payloads'});const c=new MessageCommandStore(s).claim(process.argv[2],30000);process.stdout.write(JSON.stringify(c?.id??null));s.close();`;
 try {
  const results=await Promise.all(Array.from({length:4},(_,i)=>promisify(execFile)(process.execPath,["--input-type=module","-e",script,root,`owner-${i}`])));
  assert.deepEqual(results.map(r=>JSON.parse(r.stdout)).filter(Boolean),[saved.id]);
 } finally {rmSync(root,{recursive:true,force:true});}
});


test("room rotation and database-wide slots preserve control capacity across dispatch owners",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-fair-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
 const commands=new MessageCommandStore(store);
 let stream=0;
 const add=(room,session,delivery="queue")=>{const key=`key-${++stream}`;return store.transaction(()=>commands.insert({key,sessionId:session,roomId:room,eventId:key,streamId:stream,delivery,...commands.prepare({sessionId:session,roomId:room,text:key,delivery})}));};
 try {
  for(let i=0;i<20;i++) add("noisy",`a-${i}`);
  for(let i=0;i<10;i++) add("quiet",`b-${i}`);
  const claims=[];
  for(let i=0;i<10;i++) claims.push(commands.claim(`owner-${i}`,30000));
  assert.deepEqual(claims.slice(0,4).map(c=>c.roomId),["noisy","quiet","noisy","quiet"]);
  assert.equal(claims.filter(c=>c.roomId==="noisy").length,5);
  assert.equal(commands.claim("overflow",30000),undefined);
  const steer=add("noisy",claims[0].sessionId,"steer");
  assert.equal(commands.claim("control",30000).id,steer.id);
  // Completing one slot does not grant a busy room an extra slot.
  commands.recordOutput(claims[1].sessionId,claims[1].eventId,"message_finished");
  assert.equal(commands.claim("replacement",30000).roomId,"quiet");
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});

test("byte and wait-age limits reject new work while preserving duplicate receipts and steering",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-budgets-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});
 const commands=new MessageCommandStore(store);
 let stream=0;
 const add=(key,session,text="x",delivery="queue")=>store.transaction(()=>commands.insert({key,sessionId:session,roomId:"room",eventId:key,streamId:++stream,delivery,...commands.prepare({sessionId:session,roomId:"room",text,delivery})}));
 try {
  for(let i=0;i<4;i++) add(`big-${i}`,"large","x".repeat(1024*1024));
  const capacity=commands.health();assert.equal(capacity.status,"degraded");assert.ok(capacity.admissionCapacity.sessions.some(row=>row.sessionId==="large"&&row.delivery==="queue"&&!row.available));
  assert.throws(()=>add("overflow","large"),{code:"command_overloaded"});
  assert.equal(add("big-0","large","x".repeat(1024*1024)).eventId,"big-0");
  const waiting=add("old","waiting");
  store.db.prepare("UPDATE message_commands SET created_at=? WHERE id=?").run(Date.now()-10*60*1000-1,waiting.id);
  assert.throws(()=>add("age-overflow","waiting"),{code:"command_overloaded"});
  assert.equal(add("unrelated","small").state,"accepted");
  const blockedFirst=add("blocked-first","blocked"),blockedSuccessor=add("blocked-successor","blocked");
  store.db.prepare("UPDATE message_commands SET state='interrupted' WHERE id=?").run(blockedFirst.id);
  store.db.prepare("UPDATE message_commands SET created_at=? WHERE id=?").run(Date.now()-15*60*1000-1,blockedSuccessor.id);
  assert.equal(add("same-room-other-session","independent").state,"accepted","a FIFO-blocked successor must not spend room/global wait-age capacity");
  assert.throws(()=>add("blocked-new","blocked"),{code:"command_reconciliation_required",retryable:false});
  assert.equal(add("control","waiting","steer","steer").state,"accepted");
  assert.equal(commands.get(waiting.id).state,"accepted");
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("clear queue fences unstarted claims and preserves dispatched receipt ownership",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-clear-"));
 const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);
 const add=(id,session)=>store.transaction(()=>commands.insert({key:id,sessionId:session,roomId:"room",eventId:id,streamId:Number(id),delivery:"queue",...commands.prepare({sessionId:session,roomId:"room",text:id,delivery:"queue"})}));
 try {
  const first=add("1","a");add("2","a");const claimed=commands.claim("owner",30000);
  assert.equal(commands.cancelPending("a"),2);
  assert.equal(commands.transition(first.id,"owner",claimed.token,"initializing"),false);
  const running=add("3","a");const live=commands.claim("owner",30000);commands.transition(live.id,"owner",live.token,"initializing");
  add("4","a");assert.equal(commands.cancelPending("a"),1);assert.equal(commands.get(running.id).state,"initializing");
  commands.recordOutput("a","3","message_finished");
  const next=add("5","a");assert.equal(commands.claim("owner",30000).id,next.id);
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("receipt polling retains an older active turn after a long stream of terminal steering receipts",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-visible-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);
 const add=(i,delivery)=>store.transaction(()=>commands.insert({key:`receipt-${i}`,sessionId:"a",roomId:"room",eventId:`receipt-${i}`,streamId:i,delivery,...commands.prepare({sessionId:"a",roomId:"room",text:"x",delivery})}));
 try {
  const running=add(1,"queue");const claim=commands.claim("owner",30000);commands.transition(claim.id,"owner",claim.token,"running");
  for(let i=2;i<102;i++){add(i,"steer");commands.recordOutput("a",`receipt-${i}`,"message_steered");}
  const receipts=commands.list("a");assert.equal(receipts.length,65);assert.equal(receipts.find(r=>r.id===running.id).state,"running");
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("lease recovery monotonically honors every terminal output with a deterministic persistence barrier",()=>{
 for(const [type,expected] of [["message_finished","completed"],["session_error","failed"],["message_steered","completed"]]){
  const root=mkdtempSync(join(tmpdir(),"pibo-command-terminal-race-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);const room=new ChatRoomService(store).ensureDefaultRoom();const session=new InMemoryPiboSessionStore().create({channel:"test",kind:"chat",profile:"base",metadata:{chatRoomId:room.id}});const ingest=new ChatDataIngestService(store);
  try{
   ingest.ingestUserMessageAccepted({session,roomId:room.id,actorId:"actor",text:"x",eventId:"event"});
   const saved=store.transaction(()=>commands.insert({key:type,sessionId:session.id,roomId:room.id,eventId:"event",streamId:1,delivery:type==="message_steered"?"steer":"queue",...commands.prepare({sessionId:session.id,roomId:room.id,text:"x",delivery:type==="message_steered"?"steer":"queue"})}));
   const claim=commands.claim("expired-owner",1000);commands.transition(claim.id,"expired-owner",claim.token,"running");store.db.prepare("UPDATE message_commands SET lease_until=0 WHERE id=?").run(saved.id);
   let crossed=false;commands.recoverExpiredLeases(Date.now(),()=>{crossed=true;ingest.ingestOutputEvent({session,roomId:room.id,event:{type,piboSessionId:session.id,eventId:"event",source:"test",...(type==="session_error"?{error:"terminal fixture"}:type==="message_steered"?{text:"x",activeEventId:"active"}:{})}});});
   assert.equal(crossed,true);assert.equal(commands.get(saved.id).state,expected);assert.equal(store.db.prepare("SELECT owner,lease_until FROM message_commands WHERE id=?").get(saved.id).owner,null);
   assert.equal(commands.reconcileInterrupted().reconciled,0);assert.equal(commands.get(saved.id).state,expected);assert.equal(Number(store.db.prepare("SELECT count(*) n FROM event_log WHERE event_id='event' AND type=?").get(type).n),1);
   const projected=store.db.prepare("SELECT s.status session_status,n.status navigation_status FROM sessions s JOIN session_navigation n ON n.session_id=s.id WHERE s.id=?").get(session.id);assert.equal(projected.session_status,type==="session_error"?"error":type==="message_steered"?"running":"idle");assert.equal(projected.navigation_status,projected.session_status);
   assert.equal(Number(store.db.prepare("SELECT count(*) n FROM event_log WHERE session_id=? AND event_id='event' AND type=?").get(session.id,type).n),1);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
 }
});

test("bounded startup reconciliation settles supported evidence, retains ambiguity, and exposes blocked successors",async()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-startup-reconcile-"));const path=join(root,"data.sqlite"),payloadRoot=join(root,"payloads");const store=new PiboDataStore(path,{payloadRootDir:payloadRoot});const commands=new MessageCommandStore(store);
 const add=(key,session,stream)=>store.transaction(()=>commands.insert({key,sessionId:session,roomId:"room",eventId:key,streamId:stream,delivery:"queue",...commands.prepare({sessionId:session,roomId:"room",text:key,delivery:"queue"})}));
 try{
  const evidenced=add("evidenced","one",1),ambiguous=add("ambiguous","two",2),successor=add("successor","two",3);
  store.db.prepare("UPDATE message_commands SET state='interrupted',error='expired' WHERE id IN (?,?)").run(evidenced.id,ambiguous.id);
  store.eventLog.appendEvent({sessionId:"one",roomId:"room",topic:"pibo.output",type:"session_error",source:"test",eventId:"evidenced",retentionClass:"audit_event"});
  const storage=new AsyncChatStorage(path,payloadRoot);try{
   assert.equal((await storage.commandReceipt(evidenced.id)).state,"failed");assert.equal((await storage.commandReceipt(ambiguous.id)).state,"interrupted");assert.equal((await storage.commandReceipt(successor.id)).state,"failed");
   assert.equal(await storage.claimCommand("must-not-replay",1000),undefined);
  }finally{await storage.close();}
  const repeated=commands.reconcileInterrupted();assert.equal(repeated.reconciled,0);assert.equal(commands.get(ambiguous.id).state,"interrupted");
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("one malformed reconciliation candidate cannot prevent an unrelated terminal repair",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-reconcile-isolation-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);const add=(key,stream)=>store.transaction(()=>commands.insert({key,sessionId:key,roomId:"room",eventId:key,streamId:stream,delivery:"queue",...commands.prepare({sessionId:key,roomId:"room",text:key,delivery:"queue"})}));
 try{const malformed=add("malformed",1),good=add("good",2);store.db.prepare("UPDATE message_commands SET state='interrupted' WHERE id IN (?,?)").run(malformed.id,good.id);for(const key of ["malformed","good"])store.eventLog.appendEvent({sessionId:key,roomId:"room",topic:"pibo.output",type:"message_finished",source:"test",eventId:key,retentionClass:"audit_event"});const original=store.db.prepare.bind(store.db);store.db.prepare=sql=>{const statement=original(sql);if(sql.startsWith("UPDATE message_commands SET state=")){const run=statement.run.bind(statement);statement.run=(...args)=>{if(args[1]===malformed.id)throw new Error("malformed row fixture");return run(...args);};}return statement;};const result=commands.reconcileInterrupted();assert.equal(result.errors,1);assert.equal(commands.get(malformed.id).state,"interrupted");assert.equal(commands.get(good.id).state,"completed");}
 finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("admission behind interrupted FIFO fails atomically while duplicate receipts and unrelated rooms remain available",async()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-barrier-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const room=new ChatRoomService(store).ensureDefaultRoom();const sessions=new InMemoryPiboSessionStore();const blocked=sessions.create({channel:"test",kind:"chat",profile:"base",metadata:{chatRoomId:room.id}});const other=sessions.create({channel:"test",kind:"chat",profile:"base",metadata:{chatRoomId:room.id}});const storage=new AsyncChatStorage(store.path,join(root,"payloads"));
 const admit=(session,id,text="same".repeat(5000))=>storage.admit({roomId:room.id,piboSessionId:session.id,eventType:"user.message.accepted",actorType:"user",actorId:"actor",clientTxnId:id,retentionClass:"chat_message",payload:{type:"user.message.accepted",text,clientTxnId:id}},session,text,{eventId:id,delivery:"queue"});
 try{
  const first=await admit(blocked,"first");store.db.prepare("UPDATE message_commands SET state='interrupted',error='ambiguous',created_at=? WHERE id=?").run(Date.now()-16*60*1000,first.receipt.id);
  const duplicate=await admit(blocked,"first");assert.equal(duplicate.created,false);assert.equal(duplicate.receipt.id,first.receipt.id);const payloadsBefore=Number(store.db.prepare("SELECT count(*) n FROM payloads").get().n),payloadFilesBefore=readdirSync(join(root,"payloads"),{recursive:true}).length;
  for(const id of ["second","third"]){await assert.rejects(admit(blocked,id),error=>error.code==="command_reconciliation_required"&&error.retryable===false&&error.scope==="session"&&error.blockingCommandId===first.receipt.id);}
  assert.equal(Number(store.db.prepare("SELECT count(*) n FROM message_commands").get().n),1);assert.equal(Number(store.db.prepare("SELECT count(*) n FROM event_log WHERE type='user.message.accepted'").get().n),1);assert.equal(Number(store.db.prepare("SELECT count(*) n FROM payloads").get().n),payloadsBefore);assert.equal(readdirSync(join(root,"payloads"),{recursive:true}).length,payloadFilesBefore);
  const admitted=await admit(other,"unrelated");assert.equal(admitted.receipt.state,"accepted","an old blocked session must not become room/global wait-age overload");
 }finally{await storage.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test("durable queue health separates dispatchable backlog from FIFO degradation using bounded metadata",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-health-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);const add=(key,session,stream)=>store.transaction(()=>commands.insert({key,sessionId:session,roomId:"room",eventId:key,streamId:stream,delivery:"queue",...commands.prepare({sessionId:session,roomId:"room",text:"secret body",delivery:"queue"})}));
 try{
  const healthy=add("healthy","healthy",1);let status=commands.health();assert.equal(status.status,"healthy");assert.equal(status.oldestDispatchableWaitMs>=0,true);
  const blocker=add("blocker","blocked",2);add("successor","blocked",3);store.db.prepare("UPDATE message_commands SET state='interrupted',error='ambiguous' WHERE id=?").run(blocker.id);
  status=commands.health();assert.equal(status.status,"degraded");assert.equal(status.interruptedPredecessors,1);assert.equal(status.blockedSuccessors,1);assert.equal(status.affectedScopes[0].blockingCommandId,blocker.id);assert.equal(JSON.stringify(status).includes("secret body"),false);
  commands.recordOutput("healthy",healthy.eventId,"message_finished");
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("health summaries remain operationally bounded across large terminal history",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-large-health-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);
 try{
  const seed=store.transaction(()=>commands.insert({key:"seed",sessionId:"seed",roomId:"room",eventId:"seed",streamId:1,delivery:"queue",...commands.prepare({sessionId:"seed",roomId:"room",text:"not exposed",delivery:"queue"})}));commands.recordOutput("seed","seed","message_finished");const payload=store.db.prepare("SELECT payload_ref,payload_bytes FROM message_commands WHERE id=?").get(seed.id);
  store.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO message_commands(id,request_key,fingerprint,session_id,room_id,event_id,stream_id,payload_ref,payload_bytes,delivery,state,created_at,updated_at) SELECT 'cmd_history_'||x,'history-'||x,'fingerprint-'||x,'history-session','room','history-event-'||x,x+1,?,?,'queue','completed',1,1 FROM n`).run(payload.payload_ref,payload.payload_bytes);
  const original=store.db.prepare.bind(store.db);store.db.prepare=sql=>{if(/^\s*SELECT/i.test(sql))assert.doesNotMatch(sql,/\bpayloads\b|\bevent_log\b/,"health must not inspect payload bodies or event history");return original(sql);};
  const health=commands.health();assert.equal(health.counts.find(row=>row.state==="completed"&&row.delivery==="queue").count,5001);assert.equal(health.status,"healthy");assert.equal(health.affectedScopes.length,0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("FIFO predecessor checks use the state-and-stream covering index instead of scanning terminal history",()=>{
 const root=mkdtempSync(join(tmpdir(),"pibo-command-index-"));const store=new PiboDataStore(join(root,"data.sqlite"),{payloadRootDir:join(root,"payloads")});const commands=new MessageCommandStore(store);
 try {
  const prepared=commands.prepare({sessionId:"a",roomId:"room",text:"x",delivery:"queue"});
  store.transaction(()=>commands.insert({key:"indexed",sessionId:"a",roomId:"room",eventId:"indexed",streamId:1,delivery:"queue",...prepared}));
  const prepare=store.db.prepare.bind(store.db);let sql;
  store.db.prepare=text=>{if(text.includes("WITH occupied AS"))sql=text;return prepare(text);};
  assert.ok(commands.claim("owner",30000));assert.ok(sql);
  const details=prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row=>row.detail).join("\n");
  assert.match(details,/p USING COVERING INDEX message_commands_dispatch_order/);
  assert.doesNotMatch(details,/p USING INDEX message_commands_recent/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
