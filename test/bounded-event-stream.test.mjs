import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {BoundedEventStream} from '../dist/apps/chat/bounded-event-stream.js';

test('slow SSE consumers release byte-bounded queues without consuming a partial frame',async()=>{
 const reasons=[];const stream=new BoundedEventStream(reason=>reasons.push(reason),64,1000,8);
 stream.writer.enqueue(new Uint8Array(40));assert.equal(stream.status().bytes,40);
 stream.writer.enqueue(new Uint8Array(40));assert.equal(stream.status().bytes,0);assert.deepEqual(reasons,['slow_bytes']);
 const reader=stream.stream.getReader();await assert.rejects(reader.read(),/reconnect/);reader.releaseLock();
});
test('queued SSE frames expire by age and cancellation releases capacity waiters',async()=>{
 const reasons=[];const stream=new BoundedEventStream(reason=>reasons.push(reason),64,20,8);
 stream.writer.enqueue(new Uint8Array(40));const waiting=stream.waitForCapacity();await delay(45);
 assert.equal(await waiting,false);assert.deepEqual(reasons,['slow_age']);assert.equal(stream.status().frames,0);
 await assert.rejects(stream.stream.getReader().read(),/reconnect/);
 const cancel=new BoundedEventStream(()=>{},64,1000,8);cancel.writer.enqueue(new Uint8Array(40));const capacity=cancel.waitForCapacity();await cancel.stream.cancel();assert.equal(await capacity,false);
});
test('fast SSE readers receive complete ordered frames and a bounded replay closes after draining',async()=>{
 const reasons=[];const stream=new BoundedEventStream(reason=>reasons.push(reason),64,1000,8);const reader=stream.stream.getReader();
 const pending=reader.read();stream.writer.enqueue(new Uint8Array([1,2,3]));assert.deepEqual((await pending).value,new Uint8Array([1,2,3]));
 stream.writer.enqueue(new Uint8Array([4]));stream.finish();assert.deepEqual((await reader.read()).value,new Uint8Array([4]));assert.equal((await reader.read()).done,true);assert.deepEqual(reasons,['complete']);
});
