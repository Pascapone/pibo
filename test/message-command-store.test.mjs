import test from "node:test";
import { spawnSync, execFile } from "node:child_process";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AsyncChatStorage } from "../dist/data/async-chat-storage.js";
import { MessageCommandStore } from "../dist/data/message-command-store.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
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
  assert.throws(()=>add("overflow","large"),{code:"command_overloaded"});
  assert.equal(add("big-0","large","x".repeat(1024*1024)).eventId,"big-0");
  const waiting=add("old","waiting");
  store.db.prepare("UPDATE message_commands SET created_at=? WHERE id=?").run(Date.now()-10*60*1000-1,waiting.id);
  assert.throws(()=>add("age-overflow","waiting"),{code:"command_overloaded"});
  assert.equal(add("unrelated","small").state,"accepted");
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
