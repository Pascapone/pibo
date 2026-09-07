import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {TelemetryMaintenance} from '../dist/data/telemetry-maintenance.js';
import {AsyncTelemetryMaintenance} from '../dist/data/async-telemetry-maintenance.js';
const cutoff='2026-02-01T00:00:00Z';
function fixture(){const root=mkdtempSync(join(tmpdir(),'pibo-maintenance-'));return {root,path:join(root,'data.sqlite'),payloadRootDir:join(root,'payloads')};}
function seed(store,count=100){store.transaction(()=>{for(let i=0;i<count;i++)store.telemetry.upsertTurn({turnId:`turn${i}`,piboSessionId:`session${i}`,status:'ok',queuedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',retentionClass:'diagnostic'});});store.telemetry.upsertTurn({turnId:'active',piboSessionId:'active',status:'running',queuedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',retentionClass:'diagnostic'});}
function finish(maintenance){for(let i=0;i<1000&&maintenance.status().status==='running';i++)maintenance.step({rows:7,milliseconds:4});assert.equal(maintenance.status().status,'completed');}
test('bounded retention resumes a durable keyset, protects active work and keeps product data',()=>{
 const f=fixture();let store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});
 try{
  seed(store);store.messages.insertMessage({id:'product',sessionId:'session0',sequence:1,role:'assistant',status:'complete',createdAt:'2026-01-01',contentPreview:'durable product truth'});
  let maintenance=new TelemetryMaintenance(store.db);maintenance.start(cutoff);
  for(let i=0;i<22;i++)maintenance.step({rows:7});
  const before=maintenance.status();assert.ok(before.deleted>0&&before.deleted<100);assert.ok(before.scanned<=before.batches*7);
  maintenance.control('pause');assert.deepEqual(maintenance.step(),maintenance.status());store.close();
  store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});maintenance=new TelemetryMaintenance(store.db);assert.equal(maintenance.status().status,'paused');maintenance.control('resume');finish(maintenance);
  assert.equal(maintenance.status().deleted,100);assert.equal(maintenance.status().protected,1);assert.ok(store.telemetry.getTurnTimeline('active'));assert.equal(store.messages.getMessage('product').contentPreview,'durable product truth');
  maintenance.start(cutoff);maintenance.control('cancel');assert.equal(maintenance.step().status,'cancelled');
 }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('disk-full rolls back telemetry deletion and its cursor together',()=>{
 const f=fixture(),store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});
 try{
  seed(store,2);const maintenance=new TelemetryMaintenance(store.db);maintenance.start(cutoff);
  while(maintenance.status().table_index<4||maintenance.status().class_index<1)maintenance.step();
  store.db.exec("CREATE TABLE fault_padding(value BLOB); CREATE TRIGGER maintenance_disk_full BEFORE DELETE ON telemetry_turns BEGIN INSERT INTO fault_padding VALUES(zeroblob(4194304)); END;");
  const pages=store.db.prepare('PRAGMA page_count').get().page_count;store.db.exec(`PRAGMA max_page_count=${pages}`);
  const before=maintenance.status();assert.throws(()=>maintenance.step(),/full/i);assert.deepEqual(maintenance.status(),before);assert.ok(store.telemetry.getTurnTimeline('turn0'));
  store.db.exec('DROP TRIGGER maintenance_disk_full; PRAGMA max_page_count=1073741823');finish(maintenance);assert.equal(maintenance.status().deleted,2);
 }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('automatic maintenance runs outside the caller and continues while another turn is active',async()=>{
 const f=fixture(),store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});let worker;
 try{
  seed(store,1000);worker=new AsyncTelemetryMaintenance(f.path);await worker.command('start',cutoff);
  const deadline=Date.now()+10000;let status;
  do{await new Promise(resolve=>setTimeout(resolve,30));status=await worker.command('status');}while(status.status!=='completed'&&Date.now()<deadline);
  assert.equal(status.status,'completed');assert.equal(status.deleted,1000);assert.equal(status.protected,1);assert.ok(worker.status().worker.threadId>0);
  const checkpoint=worker.status().worker.checkpoint;assert.ok(checkpoint,'expected bounded passive checkpoint observation');
  assert.equal(typeof checkpoint.durationMs,'number');assert.ok(Number.isFinite(checkpoint.walBytes)&&checkpoint.walBytes>=0);assert.ok(Number.isFinite(checkpoint.logPages)&&Number.isFinite(checkpoint.checkpointedPages));
 }finally{await worker?.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});

test('manual pruning observes the same row bound and retains its selected class on resume',()=>{
 const f=fixture(),store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});
 try{seed(store,1000);let total=0;for(let i=0;i<100;i++){const result=store.telemetry.prune({retentionClass:'diagnostic',before:cutoff,apply:true});assert.ok(result.rowsMatched<=128);assert.ok(result.rowsDeleted<=128);total+=result.rowsDeleted;if(result.completed)break;}
 assert.equal(total,1000);assert.ok(store.telemetry.getTurnTimeline('active'));assert.equal(new TelemetryMaintenance(store.db).status().retention_scope,'diagnostic');}
 finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});

test('a preview does not restart a persisted maintenance job',async()=>{
 const f=fixture(),store=new PiboDataStore(f.path,{payloadRootDir:f.payloadRootDir});let worker;
 try{seed(store,10);new TelemetryMaintenance(store.db).start(cutoff);worker=new AsyncTelemetryMaintenance(f.path);const preview=await worker.preview(cutoff);assert.ok(preview.some(row=>row.rowsMatched>0));await new Promise(resolve=>setTimeout(resolve,100));assert.equal(new TelemetryMaintenance(store.db).status().deleted,0);}
 finally{await worker?.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
