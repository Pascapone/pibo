import assert from "node:assert/strict";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";

async function withRouter(run) {
	const router = new PiboSessionRouter({ persistSession: false });
	try {
		await run(router);
	} finally {
		await router.disposeAll();
	}
}

test("session reply waiter resolves only after message_finished with the final assistant message", async () => {
	await withRouter(async (router) => {
		let settled = false;
		router.emit = async (event) => {
			queueMicrotask(() => {
				router.emitOutput({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "planning" });
			});
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source };
		};

		const waiting = router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-1",
			text: "work",
			source: "actor",
		}).finally(() => { settled = true; });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false);

		router.emitOutput({ type: "assistant_message", piboSessionId: "ps_waiter", eventId: "message-1", text: "final answer" });
		router.emitOutput({ type: "message_finished", piboSessionId: "ps_waiter", eventId: "message-1" });
		assert.equal((await waiting).text, "final answer");
	});
});

test("session reply waiter rejects terminal session errors", async () => {
	await withRouter(async (router) => {
		router.emit = async (event) => {
			queueMicrotask(() => {
				router.emitOutput({ type: "session_error", piboSessionId: event.piboSessionId, eventId: event.id, error: "provider auth failed" });
			});
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source };
		};

		await assert.rejects(router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-2",
			text: "work",
			source: "actor",
		}), /provider auth failed/);
	});
});

test("session reply waiter propagates caller cancellation and aborts the dispatched child", async () => {
	await withRouter(async (router) => {
		const emitted = [];
		router.emit = async (event) => {
			emitted.push(event);
			return event.type === "message"
				? { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source }
				: { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: "aborted" };
		};
		const controller = new AbortController();
		const waiting = router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-cancelled",
			text: "work",
			source: "actor",
		}, 30_000, controller.signal);
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		await assert.rejects(waiting, (error) => error instanceof Error && error.name === "AbortError" && error.message === "Subagent request was aborted.");
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(emitted.some((event) => event.type === "message" && event.id === "message-cancelled"), true);
		assert.equal(emitted.some((event) => event.type === "execution" && event.action === "abort" && event.piboSessionId === "ps_waiter"), true);
	});
});

test("session reply waiter does not dispatch an already-aborted request", async () => {
	await withRouter(async (router) => {
		const emitted = [];
		router.emit = async (event) => {
			emitted.push(event);
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source };
		};
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-pre-aborted",
			text: "work",
			source: "actor",
		}, 30_000, controller.signal), (error) => error instanceof Error && error.name === "AbortError");
		assert.deepEqual(emitted, []);
	});
});

test("session reply waiter aborts the child session when its timeout expires", async () => {
	await withRouter(async (router) => {
		const emitted = [];
		router.emit = async (event) => {
			emitted.push(event);
			return event.type === "message"
				? { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source }
				: { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: "aborted" };
		};

		await assert.rejects(router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-3",
			text: "work",
			source: "actor",
		}, 10), /Timed out waiting for assistant reply/);
		assert.equal(emitted.some((event) => event.type === "execution" && event.action === "abort" && event.piboSessionId === "ps_waiter"), true);
	});
});
