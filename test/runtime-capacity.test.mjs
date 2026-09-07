import { createProviderCapacityExtension } from '../dist/core/provider-capacity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FairCapacityPool, RuntimeCapacity } from '../dist/core/runtime-capacity.js';

test('capacity rotates rooms, bounds pending work and releases exactly once', async()=>{
 const pool=new FairCapacityPool(2,1,3,1000);
 const first=await pool.acquire('noisy');
 let noisyStarted=false;
 const noisy=pool.acquire('noisy').then(lease=>{noisyStarted=true;return lease;});
 const quiet=await pool.acquire('quiet');
 assert.equal(noisyStarted,false);assert.equal(pool.snapshot().active,2);
 const another=pool.acquire('third');
 const fourth=pool.acquire('fourth');
 await assert.rejects(pool.acquire('overflow'),{code:'runtime_capacity_unavailable'});
 quiet.release();quiet.release();
 const third=await another;
 assert.equal(noisyStarted,false);assert.equal(pool.snapshot().active,2);
 first.release();const nextNoisy=await noisy;
 third.release();const last=await fourth;
 nextNoisy.release();last.release();assert.equal(pool.snapshot().active,0);assert.equal(pool.snapshot().waiting,0);
 pool.close();await assert.rejects(pool.acquire('closed'));
});

test('abort removes a capacity waiter immediately without disturbing the active turn', async()=>{
 const pool=new FairCapacityPool(1,1,2,1000);
 const active=await pool.acquire('a');const abort=new AbortController();
 const waiting=pool.acquire('b',abort.signal);abort.abort(new Error('cancelled'));
 await assert.rejects(waiting,/cancelled/);assert.equal(pool.snapshot().waiting,0);assert.equal(pool.snapshot().active,1);
 const pending=pool.acquire('c');pool.close();await assert.rejects(pending,/closed/);active.release();
 assert.equal(pool.snapshot().active,0);
});

test('provider pools are independent and discard idle keys',async()=>{
 const capacity=new RuntimeCapacity({providerTurns:1,providerTurnsPerRoom:1});
 const a=await capacity.acquireProvider('provider-a','room');
 const b=await capacity.acquireProvider('provider-b','room');
 assert.equal(capacity.snapshot().providers.length,2);
 a.release();assert.equal(capacity.snapshot().providers.length,1);
 b.release();assert.deepEqual(capacity.snapshot().providers,[]);
 capacity.close();await assert.rejects(capacity.acquireProvider('new','room'));
});


test('Pi releases the provider request before tools and reacquires for the next round',async()=>{
 const capacity=new RuntimeCapacity({providerTurns:1,providerTurnsPerRoom:1});
 const hooks=new Map();createProviderCapacityExtension(capacity,'room')({on:(name,handler)=>hooks.set(name,handler)});
 const abort=new AbortController();const ctx={model:{provider:'pi-provider'},signal:abort.signal,abort:()=>abort.abort()};
 await hooks.get('before_provider_request')({},ctx);assert.equal(capacity.snapshot().providers[0].active,1);
 hooks.get('after_provider_response')({status:200});assert.equal(capacity.snapshot().providers[0].active,1);
 hooks.get('message_end')({message:{role:'assistant'}});assert.equal(capacity.snapshot().providers.length,0);
 const child=await capacity.acquireProvider('pi-provider','room');
 let resumed=false;const next=hooks.get('before_provider_request')({},ctx).then(()=>{resumed=true;});
 await Promise.resolve();assert.equal(resumed,false);child.release();await next;
 abort.abort();assert.equal(capacity.snapshot().providers.length,0);capacity.close();
});

test('Pi capacity failure aborts explicitly because extension handler errors alone do not stop HTTP',async()=>{
 const capacity=new RuntimeCapacity({providerTurns:1,providerTurnsPerRoom:1,maxWaiting:1});
 const active=await capacity.acquireProvider('provider','room');const pending=capacity.acquireProvider('provider','other');
 const hooks=new Map();createProviderCapacityExtension(capacity,'overflow')({on:(name,handler)=>hooks.set(name,handler)});
 let aborted=false;
 await assert.rejects(hooks.get('before_provider_request')({},{model:{provider:'provider'},abort:()=>{aborted=true;}}),{code:'runtime_capacity_unavailable'});
 assert.equal(aborted,true);active.release();(await pending).release();capacity.close();
});


test('nested provider work retains slots when parent turns occupy their entire budget',async()=>{
 const capacity=new RuntimeCapacity({providerTurns:3,providerTurnsPerRoom:2,maxWaiting:4});
 const parent=await capacity.acquireProvider('provider','room');
 const queued=capacity.acquireProvider('provider','room');
 const child=await capacity.acquireProvider('provider','room',undefined,true);
 assert.equal(capacity.snapshot().providers[0].active,2);
 assert.equal(capacity.snapshot().providers[0].waiting,1);
 child.release();parent.release();(await queued).release();capacity.close();
});
