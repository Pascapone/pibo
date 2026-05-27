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
			createComposerSendPlan,
		} = await import("./src/apps/chat-ui/src/composer-send.ts");

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

		const existingEvent = { id: "existing", type: "message_queued", createdAt: "2026-05-27T09:59:00.000Z", payload: {} };
		const appendedSameSession = appendComposerOptimisticEvent({ piboSessionId: "ps-1", events: [existingEvent] }, "ps-1", plan.optimisticEvent);
		assert.deepEqual(appendedSameSession.events.map((event) => event.id), ["existing", "web-test-txn"]);

		const appendedDifferentSession = appendComposerOptimisticEvent({ piboSessionId: "ps-other", events: [existingEvent] }, "ps-1", plan.optimisticEvent);
		assert.deepEqual(appendedDifferentSession.events.map((event) => event.id), ["web-test-txn"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat composer send helpers plan optimistic queued messages and overlays", async () => {
	await assert.doesNotReject(runComposerSendScenario());
});
