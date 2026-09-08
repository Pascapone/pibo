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
  import { withMessageReceipts } from './src/apps/chat-ui/src/tracing/message-receipts.ts';
  import { rememberPendingMessageTransaction,readPendingMessageTransaction,samePendingMessageIntent } from './src/apps/chat-ui/src/composer-send.ts';
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
  assert.equal(withMessageReceipts(overlay,receipts),overlay);assert.equal(withMessageReceipts(view,[{sessionId:'other',eventId:'txn',state:'failed'}]),view);
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
