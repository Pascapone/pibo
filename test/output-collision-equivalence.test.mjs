import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PiboReliabilityStore } from '../dist/reliability/store.js';
import { ChatDataIngestService, outputPersistenceDeliveryKey } from '../dist/data/ingest-service.js';
import { InMemoryPiboSessionStore } from '../dist/sessions/store.js';
import { legacyOutputIdentityFingerprint } from '../dist/core/output-render-sequence.js';
import { reconcileOutputCollisionEquivalence } from '../dist/debug/output-collision-equivalence.js';

// Integration tests deliberately require the real Storage-owned classifier.
// No implementation-string checks, replacement hash algorithm, or fake classifier.
function fixture({legacy=false,text='same',changed=false,mixed=false}={}){
 const root=mkdtempSync(join(tmpdir(),'pibo-equivalence-'));
 const data=new PiboDataStore(join(root,'pibo.sqlite'),{payloadRootDir:join(root,'payloads')});
 const reliability=new PiboReliabilityStore(join(root,'pibo-events.sqlite'));
 const session=new InMemoryPiboSessionStore().create({id:'ps_repair',channel:'test',kind:'chat',profile:'base'});
 const ingest=new ChatDataIngestService(data);
 const canonical={type:'assistant_message',piboSessionId:session.id,eventId:'event-repair',assistantIndex:0,text};
 const committed=ingest.ingestOutputEvent({session,event:canonical});
 if(legacy){const row=data.eventLog.findByIdempotencyKey(outputPersistenceDeliveryKey(canonical));data.db.prepare('UPDATE event_log SET attributes_json=? WHERE stream_id=?').run(JSON.stringify({...row.attributes,identityFingerprint:legacyOutputIdentityFingerprint(canonical),identityFingerprintVersion:1}),committed.streamId);}
 const incoming={...canonical,text:changed?'changed':text,provenance:{source:'delegated',parentSessionId:'ps_parent'}};
 const terminal={type:'message_finished',piboSessionId:session.id,eventId:'event-repair',source:'assistant'};
 const end=ingest.ingestOutputEvent({session,event:terminal});
 const deliveries=[{deliveryId:outputPersistenceDeliveryKey(incoming),event:incoming},{deliveryId:outputPersistenceDeliveryKey(terminal),event:terminal,v2:{streamId:end.streamId},sideEffectsDelivered:true}];
 if(mixed)deliveries.push({deliveryId:'missing',event:{...terminal,eventId:'not-committed'}});
 const payload=JSON.stringify({version:1,state:{version:1,piboSessionId:session.id,deliveries}});
 reliability.db.prepare(`INSERT INTO pibo_dead_jobs(job_id,queue,payload_json,attempts,max_attempts,created_at,updated_at,dead_at,dead_reason) VALUES('dead','output-persistence',?,1,1,'2026-09-01','2026-09-01','2026-09-01','permanent_failure')`).run(payload);
 data.close();reliability.close();
 const store=(name,path)=>({name,path:join(root,path),exists:true,defaultPath:path,description:'fixture'});
 return {root,dataStore:store('pibo-data','pibo.sqlite'),reliabilityStore:store('reliability','pibo-events.sqlite'),jobId:'dead'};
}
function counts(f){const d=new DatabaseSync(f.dataStore.path,{readOnly:true});const r=new DatabaseSync(f.reliabilityStore.path,{readOnly:true});try{return {events:d.prepare('SELECT COUNT(*) n FROM event_log').get().n,audits:d.prepare("SELECT COUNT(*) n FROM event_log WHERE type='pibo.output.equivalence_reconciled'").get().n,dead:r.prepare('SELECT COUNT(*) n FROM pibo_dead_jobs').get().n};}finally{d.close();r.close();}}

for(const legacy of [false,true])test(`real classifier ${legacy?'legacy':'v2'} dry-run and audit-only apply are bounded, idempotent and delivery-specific`,async()=>{
 const f=fixture({legacy});
 try{
  const before=counts(f);const dry=await reconcileOutputCollisionEquivalence(f);
  assert.equal(dry.repairable,true,JSON.stringify(dry));assert.equal(dry.deliveries.length,2);assert.equal(dry.deliveries[1].prior.sideEffectsDelivered,true);assert.deepEqual(counts(f),before);
  const applied=await reconcileOutputCollisionEquivalence({...f,apply:true,expectedDigest:dry.evidenceDigest});assert.equal(applied.applied,true);assert.equal(applied.sideEffectsReplayed,false);assert.equal(applied.deadLetterPreserved,true);
  const retry=await reconcileOutputCollisionEquivalence({...f,apply:true,expectedDigest:dry.evidenceDigest});assert.equal(retry.idempotent,true);assert.equal(retry.auditStreamId,applied.auditStreamId);assert.deepEqual(counts(f),{...before,events:before.events+1,audits:1});
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('real semantic conflicts and incomplete mixed jobs remain untouched even with a successful terminal delivery',async()=>{
 for(const options of [{changed:true},{mixed:true}]){
  const f=fixture(options);
  try{const before=counts(f);const dry=await reconcileOutputCollisionEquivalence(f);assert.equal(dry.repairable,false);assert.ok(dry.deliveries.some(x=>!x.repairable));await assert.rejects(reconcileOutputCollisionEquivalence({...f,apply:true,expectedDigest:dry.evidenceDigest}),/not proven/);assert.deepEqual(counts(f),before);}finally{rmSync(f.root,{recursive:true,force:true});}
 }
});

test('stale dead-job evidence refuses safe apply and cannot overwrite a concurrent change',async()=>{
 const f=fixture();
 try{const dry=await reconcileOutputCollisionEquivalence(f);const r=new DatabaseSync(f.reliabilityStore.path);const row=r.prepare("SELECT payload_json p FROM pibo_dead_jobs WHERE job_id='dead'").get();const changed=JSON.parse(row.p);changed.state.deliveries[0].event.text='changed';r.prepare("UPDATE pibo_dead_jobs SET payload_json=? WHERE job_id='dead'").run(JSON.stringify(changed));r.close();const before=counts(f);await assert.rejects(reconcileOutputCollisionEquivalence({...f,apply:true,expectedDigest:dry.evidenceDigest}),/changed since dry-run/);assert.deepEqual(counts(f),before);}finally{rmSync(f.root,{recursive:true,force:true});}
});

test('external canonical payload is read with checksum/byte validation, never from its preview',async()=>{
 const f=fixture({text:'large '.repeat(3000)});
 try{const dry=await reconcileOutputCollisionEquivalence(f);assert.equal(dry.repairable,true);await assert.rejects(reconcileOutputCollisionEquivalence({...f,maxBytes:32}),/exceeds max-bytes/);const d=new DatabaseSync(f.dataStore.path);d.prepare("UPDATE payloads SET sha256=?").run('0'.repeat(64));d.close();const corrupt=await reconcileOutputCollisionEquivalence(f);assert.equal(corrupt.repairable,false);assert.ok(corrupt.deliveries.some(x=>/corrupt/.test(x.reason)));}finally{rmSync(f.root,{recursive:true,force:true});}
});
