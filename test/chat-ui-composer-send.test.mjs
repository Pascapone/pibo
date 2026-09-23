import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runComposerSendScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			appendComposerOptimisticEvent,
			beginComposerDraftSend,
			createComposerDraftTracker,
			createComposerSendPlan,
			restoreComposerDraftSend,
			settleComposerDraftSend,
			updateComposerDraft,
			withComposerSendDelivery,
		} = await import("./src/apps/chat-ui/src/composer-send.ts");
		const { adaptTrace } = await import("./src/apps/chat-ui/src/tracing/adapt.ts");

		const plan = createComposerSendPlan({
			piboSessionId: "ps-1",
			text: "Ship it",
			selectedWebAnnotations: [{ id: "ann-1" }, { id: "ann-2" }],
			selectedUploadAttachments: [{ path: "/tmp/a.png" }, { path: "/tmp/b.txt" }],
			eventSequence: 7,
			now: "2026-05-27T10:00:00.000Z",
			clientTxnId: "web-test-txn",
		});

		assert.equal(plan.text, "Ship it");
		assert.deepEqual(plan.webAnnotationIds, ["ann-1", "ann-2"]);
		assert.deepEqual(plan.fileAttachmentPaths, ["/tmp/a.png", "/tmp/b.txt"]);
		assert.equal(plan.clientTxnId, "web-test-txn");
		assert.equal(plan.delivery, "queue");
		assert.deepEqual(plan.optimisticEvent, {
			id: "web-test-txn",
			piboSessionId: "ps-1",
			eventSequence: 7,
			eventId: "web-test-txn",
			type: "message_queued",
			createdAt: "2026-05-27T10:00:00.000Z",
			payload: {
				type: "message_queued",
				piboSessionId: "ps-1",
				eventId: "web-test-txn",
				clientTxnId: "web-test-txn",
				delivery: "queue",
				queuedMessages: 1,
				text: "Ship it",
				fileAttachmentPaths: ["/tmp/a.png", "/tmp/b.txt"],
				source: "user",
			},
		});

		const textOnlyPlan = createComposerSendPlan({
			piboSessionId: "ps-1",
			text: "No attachments",
			selectedWebAnnotations: [],
			selectedUploadAttachments: [],
			eventSequence: 8,
			now: "2026-05-27T10:01:00.000Z",
			clientTxnId: "web-test-no-attachments",
		});
		assert.deepEqual(textOnlyPlan.webAnnotationIds, []);
		assert.deepEqual(textOnlyPlan.fileAttachmentPaths, []);
		assert.equal(Object.hasOwn(textOnlyPlan.optimisticEvent.payload, "fileAttachmentPaths"), false);

		const steerPlan = withComposerSendDelivery(plan, "steer");
		assert.equal(steerPlan.delivery, "steer");
		assert.equal(steerPlan.optimisticEvent.type, "message_steered");
		assert.equal(steerPlan.optimisticEvent.payload.type, "message_steered");
		assert.equal(steerPlan.optimisticEvent.payload.delivery, "steer");
		assert.equal(Object.hasOwn(steerPlan.optimisticEvent.payload, "queuedMessages"), false);

		const pendingQueueSpan = adaptTrace("ps-1", "Test", [{
			id: "event:message_queued:web-test-txn",
			piboSessionId: "ps-1",
			eventId: "web-test-txn",
			type: "user.message",
			title: "User Message",
			status: "running",
			startedAt: "2026-05-27T10:00:00.000Z",
			output: "Ship it",
			children: [],
		}]).spans[0];
		assert.equal(pendingQueueSpan.attributes["message.pending_delivery"], "queue");
		const pendingSteerSpan = adaptTrace("ps-1", "Test", [{
			id: "event:message_steered:web-test-txn",
			piboSessionId: "ps-1",
			eventId: "web-test-txn",
			type: "user.message",
			title: "User Message",
			status: "running",
			startedAt: "2026-05-27T10:00:00.000Z",
			output: "Ship it",
			children: [],
		}]).spans[0];
		assert.equal(pendingSteerSpan.attributes["message.pending_delivery"], "steer");

		const delegationSpan = adaptTrace("ps-1", "Test", [{
			id: "tool:shared-agent",
			piboSessionId: "ps-1",
			type: "agent.delegation",
			title: "pibo_agents_send_message",
			status: "done",
			startedAt: "2026-05-27T10:02:00.000Z",
			completedAt: "2026-05-27T10:02:01.000Z",
			input: { name: "explorer", message: "Inspect the route" },
			linkedPiboSessionId: "ps-child",
			children: [],
		}]).spans[0];
		assert.equal(delegationSpan.attributes["delegation.target_agent"], "explorer");
		assert.equal(delegationSpan.attributes.linked_pibo_session_id, "ps-child");

		const existingEvent = { id: "existing", type: "message_queued", createdAt: "2026-05-27T09:59:00.000Z", payload: {} };
		const appendedSameSession = appendComposerOptimisticEvent({ piboSessionId: "ps-1", events: [existingEvent] }, "ps-1", plan.optimisticEvent);
		assert.deepEqual(appendedSameSession.events.map((event) => event.id), ["existing", "web-test-txn"]);

		const appendedDifferentSession = appendComposerOptimisticEvent({ piboSessionId: "ps-other", events: [existingEvent] }, "ps-1", plan.optimisticEvent);
		assert.deepEqual(appendedDifferentSession.events.map((event) => event.id), ["web-test-txn"]);

		let draft = beginComposerDraftSend(createComposerDraftTracker("Ship it"), plan);
		draft = updateComposerDraft(draft, "");
		let rollback = restoreComposerDraftSend(draft, plan);
		assert.equal(rollback.restored, true);
		assert.equal(rollback.tracker.value, "Ship it");

		draft = beginComposerDraftSend(createComposerDraftTracker("Ship it"), plan);
		draft = updateComposerDraft(draft, "");
		draft = updateComposerDraft(draft, "new draft");
		rollback = restoreComposerDraftSend(draft, plan);
		assert.equal(rollback.restored, false);
		assert.equal(rollback.tracker.value, "new draft");

		draft = beginComposerDraftSend(createComposerDraftTracker("Ship it"), plan);
		draft = updateComposerDraft(draft, "");
		const newerPlan = { ...plan, clientTxnId: "newer-txn", text: "Newer" };
		draft = beginComposerDraftSend(draft, newerPlan);
		rollback = restoreComposerDraftSend(draft, plan);
		assert.equal(rollback.restored, false);
		assert.equal(rollback.tracker.owner.clientTxnId, "newer-txn");

		draft = settleComposerDraftSend(draft, newerPlan.clientTxnId);
		assert.equal(draft.owner, undefined);

		const plainDraft = updateComposerDraft(createComposerDraftTracker("hello"), "");
		assert.equal(plainDraft.value, "");
		assert.equal(plainDraft.revision, 1);
		assert.equal(plainDraft.owner, undefined);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat composer send helpers plan optimistic queued messages and overlays", async () => {
	await assert.doesNotReject(runComposerSendScenario());
});

test("pending typed intent distinguishes note, owner and legacy wire shapes across reload", async () => {
 await execFileAsync(process.execPath,["--import","tsx","--input-type=module","--eval",`
 import assert from 'node:assert/strict';
 import {createComposerSendPlan,readPendingMessageTransaction,rememberPendingMessageTransaction,samePendingMessageIntent} from './src/apps/chat-ui/src/composer-send.ts';
 import {structuredComposerIntent} from './src/apps/chat-ui/src/attachments/core-attachment-composer-intent.ts';
 const store=new Map();globalThis.window={sessionStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
 const note=text=>({envelope:{id:'att_1',revision:1,type:'pibo.core/note',schemaVersion:1},payload:{text}});
 const a=structuredComposerIntent([note('old')],'alice');const b=structuredComposerIntent([note('new')],'alice');
 assert.match(a,/^sha256:[0-9a-f]{64}$/);assert.notEqual(a,b);
 assert.notEqual(a,structuredComposerIntent([note('old')],'bob'));
 const base={piboSessionId:'ps_1',text:'message',selectedWebAnnotations:[],selectedUploadAttachments:[],eventSequence:1,now:'2026-09-23T00:00:00Z',clientTxnId:'txn'};
 const typed=createComposerSendPlan({...base,attachmentIntent:a});rememberPendingMessageTransaction(typed);
 const restored=readPendingMessageTransaction();assert.equal(restored.attachmentIntent,a);
 const intent={piboSessionId:'ps_1',text:'message',webAnnotationIds:[],fileAttachmentPaths:[]};
 assert.equal(samePendingMessageIntent(restored,{...intent,attachmentIntent:a}),true);
 assert.equal(samePendingMessageIntent(restored,{...intent,attachmentIntent:b}),false);
 assert.equal(samePendingMessageIntent(restored,intent),false);
 store.set('pibo.chat.pending-message-transaction.v2',JSON.stringify({...intent,clientTxnId:'legacy',delivery:'queue'}));
 const legacy=readPendingMessageTransaction();assert.equal(samePendingMessageIntent(legacy,intent),true);
 assert.equal(samePendingMessageIntent(legacy,{...intent,attachmentIntent:a}),false);
 `],{cwd:process.cwd(),timeout:30000,maxBuffer:1024*1024});
});
