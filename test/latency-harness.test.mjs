import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { distribution, verifyCommandIntegrity, parseArgs } from '../scripts/latency-harness.mjs';

test('admission p99 is unavailable below 1000 real samples; empty distributions never pass as zero',()=>{
 assert.equal(distribution([]).p95,null);
 assert.equal(distribution(Array.from({length:999},(_,i)=>i)).p99,null);
 assert.equal(distribution(Array.from({length:1000},(_,i)=>i)).p99,989);
 assert.throws(()=>parseArgs(['--samples','Infinity']),/expected/);
 assert.throws(()=>parseArgs(['--soak-seconds','10801']),/expected/);
 assert.throws(()=>parseArgs(['--max-commands','20','--samples','1000']),/warmup/);
});

test('integrity tracks IDs and committed evidence, not equality of counts',()=>{
 const accepted=[{id:'c1',eventId:'e1',sessionId:'s1',text:'one'},{id:'c2',eventId:'e2',sessionId:'s2',text:'two'}];
 const result={commands:accepted.map(c=>({...c,state:'completed',admissions:1,terminals:1,outputs:1})),effects:[['one',1],['two',1]],collisions:0,pendingOutputJobs:0,deadOutputJobs:0};
 assert.equal(verifyCommandIntegrity(accepted,result).passed,true);
 for(const mutate of [
  x=>{x.commands[1].id='untracked';},
  x=>{[x.commands[0].eventId,x.commands[1].eventId]=[x.commands[1].eventId,x.commands[0].eventId];},
  x=>{x.commands[1].state='interrupted';},
  x=>{x.commands[1].outputs=2;},
  x=>{x.effects[1][1]=2;},
  x=>{x.collisions=1;},
  x=>{x.pendingOutputJobs=1;},
  x=>{x.effects.push(['untracked',1]);},
 ]){const changed=structuredClone(result);mutate(changed);assert.equal(verifyCommandIntegrity(accepted,changed).passed,false);}
});

test('finite local harness uses real HTTP admission/receipts and refuses a smoke as reference acceptance',async()=>{
 const root=mkdtempSync(join(tmpdir(),'latency-harness-test-'));
 try {
  const out=join(root,'run');
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/latency-harness.mjs','--candidate','cac4dcd03945b9754db7be9ab2ab4324f10c335c','--sessions','20','--samples','8','--pairs','2','--soak-seconds','1','--sampler','off','--out',out,'--enforce'],{timeout:120000,maxBuffer:1024*1024}),error=>error.code===1&&error.stdout.includes('p99 requires 1000'));
  const run=JSON.parse(readFileSync(join(out,'run.json')));
  const profile=run.results[0];
  assert.equal(profile.integrity.passed,true,JSON.stringify(profile.integrity));
  assert.equal(profile.admission.n,8);assert.equal(profile.admission.p99,null);
  assert.equal(profile.passed,false);assert.equal(profile.soak.capped,false);
  assert.ok(profile.soak.actualSeconds>=1);assert.ok(profile.duplicateRetries>0);
  const admission=readFileSync(join(out,'sessions-20','admission.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(admission.every(row=>row.id.startsWith('cmd_')&&row.serverTiming.includes('chat_ack;dur=')));
  const effects=readFileSync(join(out,'sessions-20','effects.jsonl'),'utf8').trim().split('\n');
  assert.equal(effects.length,profile.integrity.accepted);
 } finally {rmSync(root,{recursive:true,force:true});}
});
