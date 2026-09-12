import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderPendingDelivery() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		const { PendingUserMessageDelivery } = await import("./src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx");
		const queue = renderToStaticMarkup(React.createElement(PendingUserMessageDelivery, { delivery: "queue" }));
		const steer = renderToStaticMarkup(React.createElement(PendingUserMessageDelivery, { delivery: "steer" }));
		assert.match(queue, /data-pibo-debug="pending-user-message-queue"/);
		assert.match(queue, /aria-live="polite"/);
		assert.match(queue, /Sending message/);
		assert.doesNotMatch(queue, /Queued for next turn/);
		const confirmed = renderToStaticMarkup(React.createElement(PendingUserMessageDelivery, { delivery: "queue", state: "session_queue" }));
		assert.match(confirmed, /Queued for next turn/);
		assert.match(confirmed, /Waiting for the active turn to finish\./);
		assert.match(steer, /data-pibo-debug="pending-user-message-steer"/);
		assert.match(steer, /Steering pending/);
		assert.match(steer, /Waiting for the next tool call boundary\./);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("pending Queue and Steer feedback exposes stable live-region semantics", async () => {
	await renderPendingDelivery();
});

test("pending delivery metadata reaches both Terminal and trace-tree renderers", async () => {
	const [rows, terminal, adapt, span] = await Promise.all([
		readFile("src/session-ui/terminalRows.ts", "utf8"),
		readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/adapt.ts", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/SpanNode.tsx", "utf8"),
	]);
	assert.match(rows, /pendingMessageDelivery\?: "queue" \| "steer"/);
	assert.match(rows, /messageDeliveryState: node\.messageDeliveryState/);
	assert.match(terminal, /<PendingUserMessageDelivery delivery=\{row\.pendingMessageDelivery\}/);
	assert.match(adapt, /attributes\["message\.pending_delivery"\] = pendingDelivery/);
	assert.match(span, /<PendingUserMessageDelivery delivery=\{pendingDelivery\}/);
});


test("receipt overlays retain unchanged nodes and browser retry identity survives reload", async () => {
 const script = `
  import assert from 'node:assert/strict';
  import { MessageReceiptReconciliationTracker,isAcceptanceUnknownError,isTerminalMessageReceipt,matchingMessageReceipt,messageReceiptPollDelay,messageReceiptRefetchInterval,terminalMessageReceiptRevision,withMessageReceipts } from './src/apps/chat-ui/src/tracing/message-receipts.ts';
  import { appendComposerOptimisticEvent,rememberPendingMessageTransaction,readPendingMessageTransaction,samePendingMessageIntent } from './src/apps/chat-ui/src/composer-send.ts';
  const values = new Map();
  globalThis.window = {sessionStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
  const plan={piboSessionId:'s',text:'hello',clientTxnId:'txn',delivery:'queue',webAnnotationIds:[],fileAttachmentPaths:[]};
  rememberPendingMessageTransaction(plan);
  const recovered=readPendingMessageTransaction();assert.equal(recovered.clientTxnId,'txn');assert.ok(samePendingMessageIntent(recovered,plan));assert.equal(samePendingMessageIntent(recovered,{...plan,text:'changed'}),false);
  rememberPendingMessageTransaction(null);assert.equal(readPendingMessageTransaction(),null);
  const untouched={id:'assistant',type:'assistant.message',children:[]};
  const user={id:'event:message_queued:txn',type:'user.message',eventId:'txn',children:[]};
  const view={piboSessionId:'s',nodes:[user,untouched]};
  const receipts=[{sessionId:'s',eventId:'txn',state:'accepted'}];
  const overlay=withMessageReceipts(view,receipts);assert.equal(overlay.nodes[0].messageDeliveryState,'accepted');assert.equal(overlay.nodes[1],untouched);assert.equal(user.messageDeliveryState,undefined);
  assert.equal(withMessageReceipts(overlay,receipts),overlay);
  const terminalTurn={id:'turn',type:'agent.turn',eventId:'txn',status:'done',completedAt:'2026-09-12T12:00:00.000Z',children:[]};
  const terminalView={...view,nodes:[user,terminalTurn]};
  const runningReceipt=[{sessionId:'s',eventId:'txn',state:'running'}];
  const terminalOverlay=withMessageReceipts(terminalView,runningReceipt);
  assert.equal(terminalOverlay.nodes[0].messageDeliveryState,'completed','terminal trace evidence outranks a stale running receipt during a 15s poll backoff');
  assert.equal(withMessageReceipts({...terminalView,nodes:[{...user,messageDeliveryState:'sending'},terminalTurn]},[]).nodes[0].messageDeliveryState,'completed','terminal trace evidence also clears optimistic sending when receipt GET is empty or failed');
  assert.equal(terminalMessageReceiptRevision(terminalView),'txn:completed');
  assert.equal(terminalMessageReceiptRevision({...terminalView,nodes:[...terminalView.nodes,{id:'delta',type:'model.message',children:[]}]}),'txn:completed','non-terminal deltas do not schedule repeated receipt reconciliation');assert.equal(withMessageReceipts(view,[{sessionId:'other',eventId:'txn',state:'failed'}]),view);
  assert.equal(messageReceiptRefetchInterval(undefined),false,'an idle initial query does not arm an interval');
  assert.equal(messageReceiptRefetchInterval([]),false,'idle sessions stop polling after the first empty response');
  const pending={piboSessionId:'s',clientTxnId:'txn'};
  assert.ok(messageReceiptRefetchInterval(undefined,{pendingTransaction:pending,unchangedAttempts:0,jitterKey:'tab-a'})>0,'an initial GET failure cannot strand an unknown transaction');
  const firstDelay=messageReceiptRefetchInterval([], {pendingTransaction:pending,unchangedAttempts:0,jitterKey:'s'});
  const nextDelay=messageReceiptRefetchInterval([], {pendingTransaction:pending,unchangedAttempts:1,jitterKey:'s'});
  assert.ok(firstDelay>=850&&firstDelay<=1150);assert.ok(nextDelay>firstDelay,'unknown acceptance uses bounded exponential backoff with stable jitter');
  assert.equal(messageReceiptRefetchInterval([], {pendingTransaction:pending,unchangedAttempts:7,jitterKey:'s'}),false,'unknown reconciliation stops after the bounded attempt budget');
  assert.ok(messageReceiptRefetchInterval([{sessionId:'s',eventId:'txn',state:'accepted'}],{unchangedAttempts:2,jitterKey:'s'})>nextDelay);
  assert.equal(messageReceiptRefetchInterval([{state:'completed'},{state:'failed'},{state:'interrupted'}]),false,'terminal receipts stop polling');
  assert.equal(messageReceiptPollDelay(20,'s'),messageReceiptPollDelay(4,'s'),'the active backoff is capped');
  assert.notEqual(messageReceiptPollDelay(0,'session:tab-a'),messageReceiptPollDelay(0,'session:tab-b'),'per-tab jitter seeds desynchronize otherwise identical sessions');
  assert.equal(matchingMessageReceipt([{sessionId:'s',eventId:'txn',state:'completed'}],pending).state,'completed');
  assert.equal(isTerminalMessageReceipt({state:'completed'}),true);assert.equal(isTerminalMessageReceipt({state:'running'}),false);
  assert.equal(isAcceptanceUnknownError({acceptanceUnknown:true}),true);
  const tracker=new MessageReceiptReconciliationTracker('txn');
  assert.equal(tracker.observe(receipts,pending).pendingReceipt.state,'accepted');
  const terminal={sessionId:'s',eventId:'txn',state:'completed'};
  assert.deepEqual(tracker.observe([terminal],null).terminalReceipts,[terminal]);
  assert.deepEqual(tracker.observe([terminal],null).terminalReceipts,[],'a delayed terminal receipt refreshes trace once across reconnect/refetch duplicates');
  for(let index=0;index<200;index++)tracker.track('bounded-'+index,index);
  assert.equal(tracker.trackedCount(),128,'long-lived tabs retain only a bounded set of explicitly open reconciliation ids');
  const optimistic={piboSessionId:'s',events:[{id:'txn'}]};assert.equal(appendComposerOptimisticEvent(optimistic,'s',optimistic.events[0]),optimistic,'same-id retries do not duplicate optimistic admission');
 `;
 await execFileAsync(process.execPath,["--import","tsx","--input-type=module","--eval",script],{cwd:process.cwd()});
});


test("receipt polling is restarted explicitly after a newly accepted message", async () => {
 const [app,pane,receiptQuery]=await Promise.all([
  readFile("src/apps/chat-ui/src/App.tsx","utf8"),
  readFile("src/apps/chat-ui/src/session-trace-pane.tsx","utf8"),
  readFile("src/apps/chat-ui/src/tracing/use-message-receipts-query.ts","utf8"),
 ]);
 assert.match(pane,/useMessageReceiptsQuery\(/);
 assert.match(pane,/terminalMessageReceiptRevision\(rawCurrentTraceView\)/);
 assert.match(pane,/terminalReceiptTraceRevisionBySessionRef[\s\S]*messageReceiptsQuery\.refetch\(\)/);
 assert.match(receiptQuery,/refetchInterval: \(currentQuery\)/);
 assert.match(receiptQuery,/refetchIntervalInBackground: false/);
 assert.match(receiptQuery,/refetchOnReconnect: "always"/);
 assert.match(receiptQuery,/retry: false/);
 assert.match(receiptQuery,/receiptPollJitterSeedRef = useRef\(createClientTxnId\(\)\)/);
 assert.match(app,/invalidateQueries\(\{ queryKey: \["chat", "message-receipts", piboSessionId\] \}\)/);
});

test("a lost accepted POST response reconciles by receipt without a second admission", async () => {
 const script = `
  import assert from 'node:assert/strict';
  import { getMessageReceipts,postMessage } from './src/apps/chat-ui/src/api-chat-sessions.ts';
  import { isTerminalMessageReceipt,matchingMessageReceipt } from './src/apps/chat-ui/src/tracing/message-receipts.ts';
  let postCalls=0;let state='accepted';
  globalThis.fetch=async(input)=>{
   const url=String(input);
   if(url.includes('/api/chat/message-receipts'))return Response.json({receipts:[{id:'receipt-1',sessionId:'s',eventId:'txn',state,updatedAt:1}]});
   if(url.includes('/api/chat/message')){postCalls++;throw new TypeError('response lost after durable acceptance');}
   throw new Error('unexpected fetch '+url);
  };
  await assert.rejects(postMessage('s','text','txn'),{acceptanceUnknown:true});
  assert.equal(postCalls,1);
  const pending={piboSessionId:'s',clientTxnId:'txn'};
  const accepted=matchingMessageReceipt((await getMessageReceipts('s')).receipts,pending);
  assert.equal(accepted.state,'accepted');assert.equal(isTerminalMessageReceipt(accepted),false);
  state='completed';
  const terminal=matchingMessageReceipt((await getMessageReceipts('s')).receipts,pending);
  assert.equal(isTerminalMessageReceipt(terminal),true);
  assert.equal(postCalls,1,'receipt reconciliation never resubmits the POST');
 `;
 await execFileAsync(process.execPath,["--import","tsx","--input-type=module","--eval",script],{cwd:process.cwd()});
});

test("message API distinguishes unknown acceptance from explicit rejection", async () => {
 const script = `
  import assert from 'node:assert/strict';
  import { postMessage } from './src/apps/chat-ui/src/api-chat-sessions.ts';
  globalThis.fetch=async()=>{throw new TypeError('network lost');};
  await assert.rejects(postMessage('s','text','txn'),{acceptanceUnknown:true});
  globalThis.fetch=async()=>Response.json({error:'capacity',acceptanceUnknown:false},{status:429});
  await assert.rejects(postMessage('s','text','txn'),{status:429});
  globalThis.fetch=async()=>Response.json({error:'uncertain',acceptanceUnknown:true},{status:503});
  await assert.rejects(postMessage('s','text','txn'),{acceptanceUnknown:true});
  globalThis.fetch=async()=>Response.json({receipt:{id:'receipt'},admissionVersion:2},{status:202});
  assert.equal((await postMessage('s','text','txn')).receipt.id,'receipt');
  globalThis.fetch=async()=>Response.json({},{status:202});
  await assert.rejects(postMessage('s','text','txn'),{acceptanceUnknown:true});
 `;
 await execFileAsync(process.execPath,["--import","tsx","--input-type=module","--eval",script],{cwd:process.cwd()});
});
