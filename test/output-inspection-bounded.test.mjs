import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { inspectOutputDeadLetters, DEAD_LETTER_PAGE_SQL } from '../dist/debug/output-dead-letters.js';
import { runOutputInspection } from '../dist/debug/output-inspection-runner.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PiboReliabilityStore } from '../dist/reliability/store.js';

function fixture(n = 10000) {
 const root = mkdtempSync(join(tmpdir(), 'pibo-bounded-audit-'));
 const reliability = new PiboReliabilityStore(join(root, 'pibo-events.sqlite'));
 reliability.db.exec('BEGIN');
 const insert = reliability.db.prepare(`INSERT INTO pibo_dead_jobs(job_id,queue,payload_json,attempts,max_attempts,created_at,updated_at,dead_at,dead_reason) VALUES(?,?,?,1,1,?,?,?,'max_attempts')`);
 const at = '2026-09-01T00:00:00.000Z';
 for (let i = 0; i < n; i++) insert.run(`job_${String(i).padStart(8,'0')}`, i % 2 ? 'other' : 'output-persistence', JSON.stringify({ piboSessionId: i % 10 === 0 ? 'ps_target' : 'ps_other', eventId: `e${i}` }), at, at, at);
 reliability.db.exec('COMMIT'); reliability.close();
 const data = new PiboDataStore(join(root, 'pibo.sqlite')); data.close();
 // Sealed fixtures use rollback journaling so byte checks include every file.
 // Live WAL readers necessarily participate in SQLite's shared-memory lock protocol.
 for(const name of ['pibo.sqlite','pibo-events.sqlite']) {const db=new DatabaseSync(join(root,name));db.exec('PRAGMA journal_mode=DELETE');db.close();}
 const store = (name, path) => ({name, path: join(root, path), exists: true, defaultPath:path, description:'fixture'});
 return {root, dataStore:store('pibo-data','pibo.sqlite'), reliabilityStore:store('reliability','pibo-events.sqlite')};
}
function fingerprint(root) { return readdirSync(root).sort().map(name => [name, createHash('sha256').update(readFileSync(join(root,name))).digest('hex')]); }

test('100000 historical jobs: primary-key plan, bounded sparse scope, stable cursor, no writes', () => {
 const f = fixture(100000);
 try {
  const before = fingerprint(f.root);
  const db = new DatabaseSync(f.reliabilityStore.path,{readOnly:true});
  const plan = db.prepare('EXPLAIN QUERY PLAN '+DEAD_LETTER_PAGE_SQL).all('job_00099000',1);
  assert.ok(plan.some(row => /SEARCH.*INDEX.*job_id>/.test(row.detail)), JSON.stringify(plan));
  assert.ok(plan.every(row => !/SCAN|TEMP B-TREE/.test(row.detail)), JSON.stringify(plan)); db.close();
  let cursor; const ids = []; let pages = 0;
  do {
   const result = inspectOutputDeadLetters({...f, piboSessionId:'ps_target', limit:2, maxScan:12, cursor});
   assert.ok(result.budget.scannedRows <= 12);
   assert.equal(result.summary.deadOutputJobs,null);
   ids.push(...result.deadLetters.map(x=>x.jobId)); cursor=result.budget.nextCursor; pages++;
  } while (pages < 4);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(ids.slice(0,4), ['job_00000000','job_00000010','job_00000020','job_00000030']);
  const missing = inspectOutputDeadLetters({...f, piboSessionId:'absent', maxScan:7});
  assert.equal(missing.deadLetters.length,0); assert.equal(missing.budget.complete,false); assert.equal(missing.budget.reason,'scan_limit'); assert.equal(missing.budget.scannedRows,7);
  assert.throws(()=>inspectOutputDeadLetters({...f, piboSessionId:'changed', cursor}),/cursor/);
  assert.deepEqual(fingerprint(f.root),before);
  const samples=[]; for(let i=0;i<30;i++){const start=performance.now(); inspectOutputDeadLetters({...f,limit:2,maxScan:12});samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b); assert.ok(samples[28]<=250,`listing p95=${samples[28]}ms`);
  console.log(JSON.stringify({fixtureJobs:100000,listingSamples:30,p95Ms:samples[28],queryPlan:plan}));
 } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('time/result/work scopes are distinct; malformed and oversized bodies cannot leak', async () => {
 const f=fixture(2);
 try {
  const db=new DatabaseSync(f.reliabilityStore.path);
  db.prepare(`UPDATE pibo_dead_jobs SET payload_json=?,last_error=?,dead_reason=? WHERE job_id='job_00000000'`).run('secret'.repeat(20000),'secret credentials','secret credentials'); db.close();
  const result=await runOutputInspection({...f,mode:'dead-letters',limit:1,maxScan:10,timeoutMs:1000});
  assert.equal(result.budget.reason,'result_limit'); assert.equal(result.deadLetters[0].payloadValid,undefined,'over-budget payload is unvalidated, not falsely classified as malformed');
  assert.ok(!JSON.stringify(result).includes('secret'));
  const outside=await runOutputInspection({...f,mode:'dead-letters',since:'2026-09-02',maxScan:10});
  assert.equal(outside.budget.complete,true); assert.equal(outside.deadLetters.length,0);
 } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('deep audit guards real scans, reports unknown, and can be restarted with explicit work budget', async () => {
 const f=fixture(100);
 try {
  const before=fingerprint(f.root);
  const partial=await runOutputInspection({...f,mode:'audit',maxScan:10});
  assert.equal(partial.budget.complete,false); assert.equal(partial.budget.reason,'scan_limit'); assert.equal(partial.health.status,'unknown'); assert.equal(partial.summary,null);
  const complete=await runOutputInspection({...f,mode:'audit',maxScan:10000});
  assert.equal(complete.budget.complete,true); assert.equal(complete.summary.deadOutputJobs,50);
  assert.deepEqual(fingerprint(f.root),before);
 } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('audit cancellation waits for reader exit and releases a WAL snapshot before checkpoint', async () => {
 const f=fixture(10000);
 const writer=new DatabaseSync(f.reliabilityStore.path); writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
 const abort=new AbortController(); let observedReader=false; let checkpointBlocked=false;
 try {
  const result=await runOutputInspection({...f,mode:'audit',maxScan:1000000,timeoutMs:1000},{signal:abort.signal,onProgress(progress){
   if(progress.budget.scannedRows>0 && !observedReader){
    observedReader=true;
    writer.prepare("UPDATE pibo_dead_jobs SET attempts=2 WHERE job_id='job_00000000'").run();
    const blocked=writer.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
    checkpointBlocked=Number(blocked.log)>Number(blocked.checkpointed);
    abort.abort();
   }
  }});
  assert.equal(observedReader,true); assert.equal(checkpointBlocked,true,'native reader pinned the pre-write WAL snapshot before cancellation'); assert.equal(result.budget.reason,'cancelled'); assert.equal(result.health.status,'unknown');
  const checkpoint=writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); assert.equal(Number(checkpoint.busy),0); assert.equal(Number(checkpoint.log),0);
  const retry=await runOutputInspection({...f,mode:'dead-letters',limit:1}); assert.equal(retry.deadLetters[0].attempts,2);
 } finally {writer.close();rmSync(f.root,{recursive:true,force:true});}
});

test('hard deadline and pre-abort cannot leave a read process active', async () => {
 const f=fixture(10000);
 try {
  const timed=await runOutputInspection({...f,mode:'audit',timeoutMs:1,maxScan:1000000});
  assert.equal(timed.budget.reason,'time_limit'); assert.equal(timed.budget.complete,false);
  const aborted=await runOutputInspection({...f,mode:'audit'},{signal:AbortSignal.abort()}); assert.equal(aborted.budget.reason,'cancelled');
 } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('30 actual CLI listings meet the interactive 250ms p95 budget on 10000 historical jobs',async()=>{
 const f=fixture(10000),samples=[];
 try{
  for(let i=0;i<30;i++){
   const start=performance.now();
   const {stdout}=await promisify(execFile)(process.execPath,['dist/bin/pibo.js','debug','persistence','dead-letters','--limit','2','--max-scan','10','--json'],{env:{...process.env,PIBO_HOME:f.root},timeout:5000});
   samples.push(performance.now()-start);
   const page=JSON.parse(stdout);assert.equal(page.deadLetters.length,2);assert.ok(page.budget.scannedRows<=10);
  }
  samples.sort((a,b)=>a-b);console.log(JSON.stringify({cliSamples:30,fixtureJobs:10000,p95Ms:samples[28]}));
  assert.ok(samples[28]<=250,`interactive CLI p95=${samples[28]}ms exceeds 250ms`);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
