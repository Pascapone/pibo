import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {AsyncTelemetryWriter} from '../dist/data/telemetry-writer.js';
import {PiboRuntimeTelemetryRecorder,turnIdForEvent} from '../dist/core/runtime-telemetry.js';
import {PiboProviderTelemetryRecorder} from '../dist/core/provider-telemetry.js';
const session={id:'ps_isolated',channel:'test',kind:'chat',profile:'base',createdAt:'2026-09-07T00:00:00Z',updatedAt:'2026-09-07T00:00:00Z',metadata:{chatRoomId:'room_isolated'}};
function fixture(options){const root=mkdtempSync(join(tmpdir(),'pibo-isolated-telemetry-'));const store=new PiboDataStore(join(root,'db.sqlite'),{payloadRootDir:join(root,'payloads')});const writer=new AsyncTelemetryWriter(store.telemetry,options);const runtime=new PiboRuntimeTelemetryRecorder(store.telemetry,undefined,{writer});return {root,store,writer,runtime,async close(){await writer.dispose();store.close();rmSync(root,{recursive:true,force:true});}};}
function output(runtime,eventId,type){runtime.recordOutput({type,piboSessionId:session.id,eventId,text:'private text must not enter telemetry IPC',queuedMessages:0,source:'user'},{session});}
test('file telemetry persists ordered cross-recorder facts only on its worker',async()=>{
 const f=fixture({flushIntervalMs:60000});const provider=new PiboProviderTelemetryRecorder({store:f.store.telemetry,writer:f.writer,session});
 const original=f.store.db.exec.bind(f.store.db);let producerTransactions=0;f.store.db.exec=sql=>{if(/^BEGIN/i.test(sql))producerTransactions++;return original(sql);};
 try{
  output(f.runtime,'event','message_started');provider.recordRequestStart({model:'test',input:'not retained'});provider.recordResponse({status:200});provider.recordMessageEnd({role:'assistant',stopReason:'stop'});output(f.runtime,'event','message_finished');
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('event')),undefined);await f.writer.flush();
  const timeline=f.store.telemetry.getTurnTimeline(turnIdForEvent('event'));
  assert.equal(timeline.turn.status,'ok');assert.equal(timeline.providerRequests.length,1);assert.equal(timeline.providerRequests[0].status,'completed');
  assert.equal(producerTransactions,0);assert.equal(f.writer.status().mode,'worker');assert.ok(f.writer.status().worker.threadId>0);assert.equal(f.writer.status().failed,0);
 }finally{await f.close();}
});
test('SQLite lock contention delays diagnostics without blocking the producer or losing an unlocked batch',async()=>{
 const f=fixture({flushIntervalMs:0});
 try{
  f.store.db.exec('BEGIN IMMEDIATE');output(f.runtime,'locked','message_started');const flushing=f.writer.flush();
  const start=performance.now();await delay(150);assert.ok(performance.now()-start<400,'producer timer remains responsive');
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('locked')),undefined);f.store.db.exec('COMMIT');await flushing;
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('locked')).status,'running');assert.equal(f.writer.status().failed,0);assert.equal(f.writer.status().pendingBytes,0);
 }finally{if(f.store.db.isTransaction)f.store.db.exec('ROLLBACK');await f.close();}
});
test('telemetry count pressure rejects explicitly and never drains in the producer',async()=>{
 const f=fixture({maxPendingOperations:3,flushIntervalMs:60000});
 try{
  for(let i=0;i<4;i++)output(f.runtime,`pressure-${i}`,'message_started');
  assert.equal(f.writer.status().queued,3);assert.equal(f.writer.status().rejected,1);
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('pressure-0')),undefined);
  await f.writer.flush();assert.equal(f.writer.status().completed,3);assert.equal(f.writer.status().pendingBytes,0);
 }finally{await f.close();}
});

test('expired diagnostics never reach SQLite and oversized messages do not enter the queue',async()=>{
 const f=fixture({maxAgeMs:20,flushIntervalMs:60000});
 try{
  output(f.runtime,'expired','message_started');
  f.runtime.recordOutput({type:'tool_call',piboSessionId:session.id,eventId:'large',toolCallId:'large',toolName:'test',args:'x'.repeat(100000),argsComplete:true},{session});
  assert.equal(f.writer.status().rejected,1);await delay(30);await f.writer.flush();
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('expired')),undefined);assert.equal(f.writer.status().expired,1);assert.equal(f.writer.status().pendingBytes,0);
 }finally{await f.close();}
});

test('optional telemetry can resume after its previous worker has actually exited',async()=>{
 const f=fixture({flushIntervalMs:60000});
 try{
  output(f.runtime,'before-restart','message_started');await f.writer.flush();
  const previous=f.writer.client;await previous.close();assert.equal(previous.status().exited,true);
  await delay(1100);output(f.runtime,'after-restart','message_started');await f.writer.flush();
  assert.equal(f.writer.status().restarts,1);assert.equal(f.writer.status().transport.closed,false);
  assert.equal(f.store.telemetry.getTurn(turnIdForEvent('after-restart')).status,'running');
 }finally{await f.close();}
});
test('open phase queries use partial indexes instead of scanning completed phase history',async()=>{
 const f=fixture();
 try{
  const prepare=f.store.db.prepare.bind(f.store.db);const sql=[];
  f.store.db.prepare=text=>{if(text.includes("status = 'open'"))sql.push(text);return prepare(text);};
  f.store.telemetry.getOpenPhaseForTurn('turn','tool_execution');f.store.telemetry.listOpenPhasesForTurn('turn');
  assert.equal(sql.length,2);
  assert.match(prepare('EXPLAIN QUERY PLAN '+sql[0]).all('turn','tool_execution').map(r=>r.detail).join(' '),/idx_telemetry_phases_open_name/);
  assert.match(prepare('EXPLAIN QUERY PLAN '+sql[1]).all('turn').map(r=>r.detail).join(' '),/idx_telemetry_phases_open_turn/);
 }finally{await f.close();}
});
