import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { MessageCommandDispatcher } from '../dist/apps/chat/message-command-dispatcher.js';
const claim=i=>({id:`cmd-${i}`,sessionId:'session',roomId:'room',eventId:`event-${i}`,streamId:i,state:'waiting_slot',createdAt:1,updatedAt:1,token:1,text:'message',delivery:'queue'});

test('an admission arriving during an empty claim does not wait for the polling timer',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let release;const initial=new Promise(resolve=>{release=resolve;});let calls=0;let available;
 const outputs=[];
 const storage={claimCommand:async()=>{if(++calls===1)return await initial;const next=available;available=undefined;return next;},heartbeatCommand:async()=>true,transitionCommand:async()=>true};
 const dispatcher=new MessageCommandDispatcher(storage,{getSession:()=>({id:'session'}),emit:async event=>{outputs.push(event);return {type:'message_queued'};}});
 try {
  available=claim(1);dispatcher.wake();release(undefined);await yieldLoop();
  assert.equal(outputs.length,1,'an explicit wake must survive an in-flight empty claim');
 }finally{release(undefined);await dispatcher.dispose();}
});

test('a persisted terminal event releases the local claim and starts the next command without polling',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let available=claim(1);const outputs=[];
 const storage={claimCommand:async()=>{const next=available;available=undefined;return next;},heartbeatCommand:async()=>true,transitionCommand:async()=>true};
 const dispatcher=new MessageCommandDispatcher(storage,{getSession:()=>({id:'session'}),emit:async event=>{outputs.push(event);return {type:'message_queued'};}});
 try {
  await yieldLoop();assert.equal(outputs.length,1);available=claim(2);
  dispatcher.outputPersisted({type:'message_finished',piboSessionId:'session',eventId:'event-1'});
  await yieldLoop();assert.deepEqual(outputs.map(event=>event.id),['event-1','event-2']);
 }finally{await dispatcher.dispose();}
});

test('frequent dispatch checks renew active ownership only on the separate lease cadence',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});let available=claim(1);let renewals=0;
 const storage={claimCommand:async()=>{const next=available;available=undefined;return next;},heartbeatCommand:async()=>{renewals++;return true;},transitionCommand:async()=>true};
 const dispatcher=new MessageCommandDispatcher(storage,{getSession:()=>({id:'session'}),emit:async()=>({type:'message_queued'})});
 try {
  await yieldLoop();t.mock.timers.tick(9900);await yieldLoop();assert.equal(renewals,0);
  t.mock.timers.tick(100);await yieldLoop();assert.equal(renewals,1);
  t.mock.timers.tick(10000);await yieldLoop();assert.equal(renewals,2);
 }finally{await dispatcher.dispose();}
});
