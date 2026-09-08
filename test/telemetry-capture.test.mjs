import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startTelemetryCapture,inspectTelemetryCapture,TelemetryCaptureWriter,finalizeTelemetryCapture,readTelemetryCapturePage} from '../dist/data/telemetry-capture.js';
const command=session=>({recorder:'runtime',providerEventMode:'detailed',progressFlushIntervalMs:25,command:{kind:'pi',piboSessionId:session,context:{},summary:{eventType:'assistant_message_event',assistantEventType:'text_delta',byteSize:12,parseStatus:'ok',normalizedType:'assistant_delta',safeFields:{text:'secret-body-must-not-be-captured',authorization:'secret-token'}}}});
test('capture is off by default and requires explicit scope and quotas',()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-capture-'));const directory=join(root,'captures'),writer=new TelemetryCaptureWriter(directory);
 try{writer.append([command('ps_test')]);assert.equal(existsSync(directory),false);assert.throws(()=>startTelemetryCapture(directory,{sessionId:'ps_test',owner:'',durationMs:1000,maxBytes:1024,maxRows:2}),/explicit/);}
 finally{writer.close();rmSync(root,{recursive:true,force:true});}
});
test('scoped metadata capture bounds rows, excludes arbitrary payload fields and archives separately',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-capture-')),writer=new TelemetryCaptureWriter(root);
 try{
  const run=startTelemetryCapture(root,{sessionId:'ps_test',owner:'test-owner',durationMs:60000,maxBytes:10000,maxRows:2});assert.throws(()=>startTelemetryCapture(root,{sessionId:'ps_test',owner:'test-owner',durationMs:1000,maxBytes:1024,maxRows:2}),/exist/i);
  writer.append([command('ps_other'),command('ps_test'),command('ps_test'),command('ps_test')]);assert.equal(inspectTelemetryCapture(root,run.id).status,'stopped');
  const archive=await finalizeTelemetryCapture(root,run.id);assert.equal(archive.status,'archived');assert.equal(archive.rows,2);assert.ok(archive.archiveBytes<=run.maxBytes+1048576);
  writer.append([command('ps_test')]);const rows=await readTelemetryCapturePage(root,run.id);assert.equal(rows.length,2);assert.doesNotMatch(JSON.stringify(rows),/secret|ps_other|authorization/);assert.equal((await readTelemetryCapturePage(root,run.id,rows[0].sequence,1)).length,1);
  assert.deepEqual(await finalizeTelemetryCapture(root,run.id),archive);assert.equal(existsSync(join(root,'active.json')),false);
 }finally{writer.close();rmSync(root,{recursive:true,force:true});}
});
test('stopping an open capture fences its existing writer before producing an immutable archive',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pibo-capture-')),writer=new TelemetryCaptureWriter(root);
 try{const run=startTelemetryCapture(root,{sessionId:'ps_test',owner:'test-owner',durationMs:60000,maxBytes:10000,maxRows:100});writer.append([command('ps_test')]);const archive=await finalizeTelemetryCapture(root,run.id);writer.append([command('ps_test')]);assert.equal((await readTelemetryCapturePage(root,run.id)).length,1);assert.equal(inspectTelemetryCapture(root,run.id).sha256,archive.sha256);}
 finally{writer.close();rmSync(root,{recursive:true,force:true});}
});
