import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PiboDataStore} from '../dist/data/pibo-store.js';
import {createStorageBackup,verifyStorageBackup,restoreStorageBackup,readStorageBackupManifest} from '../dist/data/storage-backup.js';
function fixture(){const root=mkdtempSync(join(tmpdir(),'pibo-backup-')),payloadRoot=join(root,'payloads'),source=join(root,'source.sqlite'),destination=join(root,'backup');return {root,payloadRoot,source,destination};}
test('online WAL backup restores product history and both compressed and large external payloads',async()=>{
 const f=fixture(),store=new PiboDataStore(f.source,{payloadRootDir:f.payloadRoot});let restored;
 try{
  store.db.exec('PRAGMA wal_autocheckpoint=0');
  const texts=['small complete message','X'.repeat(1024*1024)];
  for(let i=0;i<texts.length;i++){const p=store.payloads.writePayload({value:texts[i],contentType:'text/plain',retentionClass:'product_history'});store.messages.insertMessage({id:`m${i}`,sessionId:'session',sequence:i+1,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'preview',contentPayloadRef:p.id});}
  store.db.exec('CREATE TABLE backup_fixture_padding(value BLOB); INSERT INTO backup_fixture_padding VALUES(zeroblob(2097152));');
  let concurrentWrite=false;const manifest=await createStorageBackup({...f,maxBytes:16*1024*1024,onProgress:p=>{if(p.stage==='snapshot'&&!concurrentWrite){concurrentWrite=true;store.messages.insertMessage({id:'after-snapshot',sessionId:'session',sequence:3,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'concurrent WAL write'});}}});assert.equal(concurrentWrite,true);assert.equal(manifest.status,'complete');assert.equal(manifest.payloadCount,2);assert.equal((await verifyStorageBackup(f.destination)).payloads,2);
  const paths=await restoreStorageBackup(f.destination,join(f.root,'restored'));restored=new PiboDataStore(paths.database,{payloadRootDir:paths.payloadRoot});
  assert.equal(restored.messages.getMessage('after-snapshot'),undefined);assert.ok(store.messages.getMessage('after-snapshot'));
  for(let i=0;i<texts.length;i++)assert.equal(restored.payloads.readPayloadText(restored.messages.getMessage(`m${i}`).contentPayloadRef),texts[i]);
  await assert.rejects(restoreStorageBackup(f.destination,join(f.root,'restored')),/exist/i);
  appendFileSync(join(f.destination,'payloads.jsonl'),'{}\n');await assert.rejects(verifyStorageBackup(f.destination),/hash mismatch/);
 }finally{restored?.close();store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('cancelled payload copying resumes only from the same verified snapshot and repairs a partial catalog tail',async()=>{
 const f=fixture(),store=new PiboDataStore(f.source,{payloadRootDir:f.payloadRoot});
 try{
  for(let i=0;i<3;i++)store.payloads.writePayload({value:`payload ${i}`,contentType:'text/plain',retentionClass:'product_history'});
  const controller=new AbortController();await assert.rejects(createStorageBackup({...f,signal:controller.signal,onProgress:p=>{if(p.stage==='payloads'&&p.copied===1)controller.abort();}}),/abort/i);
  assert.equal((await readStorageBackupManifest(f.destination)).status,'payloads');appendFileSync(join(f.destination,'payloads.jsonl'),'{partial');
  const resumed=await createStorageBackup({...f,resume:true});assert.equal(resumed.payloadCount,3);assert.equal((await verifyStorageBackup(f.destination)).payloads,3);
  await assert.rejects(createStorageBackup({...f,resume:true,source:join(f.root,'different.sqlite')}),/does not match/);
 }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('snapshot byte quota rejects without declaring an incomplete backup complete',async()=>{
 const f=fixture(),store=new PiboDataStore(f.source,{payloadRootDir:f.payloadRoot});
 try{await assert.rejects(createStorageBackup({...f,maxBytes:4096}),/quota/);assert.equal((await readStorageBackupManifest(f.destination)).status,'snapshot');await assert.rejects(verifyStorageBackup(f.destination),/incomplete/);assert.ok(store.db.prepare('SELECT 1').get());}
 finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
test('wal growth quota releases the source snapshot while writers keep appending',async()=>{
 const f=fixture(),store=new PiboDataStore(f.source,{payloadRootDir:f.payloadRoot});
 try{
  store.db.exec('PRAGMA wal_autocheckpoint=0');
  store.db.exec('CREATE TABLE backup_wal_padding(value BLOB); INSERT INTO backup_wal_padding VALUES(zeroblob(4194304));');
  for(let i=0;i<50;i++)store.messages.insertMessage({id:`m${i}`,sessionId:'session',sequence:i+1,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'preview'});
  let wrote=false;
  await assert.rejects(createStorageBackup({...f,maxWalGrowthBytes:4096,onProgress:progress=>{if(progress.stage==='snapshot'&&!wrote){wrote=true;store.db.exec('INSERT INTO backup_wal_padding VALUES(zeroblob(1048576));');}}}),/WAL growth quota/);
  assert.equal(wrote,true);
  assert.equal((await readStorageBackupManifest(f.destination)).status,'snapshot');
  await assert.rejects(verifyStorageBackup(f.destination),/incomplete/);
  store.messages.insertMessage({id:'after-quota',sessionId:'session',sequence:100,role:'assistant',status:'complete',createdAt:'2026-09-07',contentPreview:'still writable'});
  assert.ok(store.messages.getMessage('after-quota'));
 }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
