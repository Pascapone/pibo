import assert from "node:assert/strict";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";

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

test("router isolates output listener failures and still notifies later listeners", async () => {
	await withRouter(async (router) => {
		const observed = [];
		const originalError = console.error;
		const errors = [];
		console.error = (...args) => errors.push(args);
		try {
			router.subscribe(() => { throw new Error("indexer failed"); });
			router.subscribe((event) => observed.push(event.type));
			assert.doesNotThrow(() => router.emitOutput({ type: "message_finished", piboSessionId: "ps_listener", eventId: "turn-listener" }));
			assert.deepEqual(observed, ["message_finished"]);
			assert.equal(errors.some((args) => args.some((value) => String(value).includes("indexer failed"))), true);
		} finally {
			console.error = originalError;
		}
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

test("session reply waiter propagates caller cancellation after the child confirms targeted termination", async () => {
	await withRouter(async (router) => {
		const emitted = [];
		const cancellations = [];
		let confirmCancellation;
		router.emit = async (event) => {
			emitted.push(event);
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source };
		};
		router.cancelSessionMessage = async (piboSessionId, eventId) => {
			cancellations.push({ piboSessionId, eventId });
			await new Promise((resolve) => { confirmCancellation = resolve; });
		};
		const controller = new AbortController();
		let settled = false;
		const waiting = router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-cancelled",
			text: "work",
			source: "actor",
		}, 30_000, controller.signal).finally(() => { settled = true; });
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(emitted.some((event) => event.type === "message" && event.id === "message-cancelled"), true);
		assert.deepEqual(cancellations, [{ piboSessionId: "ps_waiter", eventId: "message-cancelled" }]);
		assert.equal(settled, false);

		router.emitOutput({ type: "assistant_message", piboSessionId: "ps_waiter", eventId: "message-cancelled", text: "late reply" });
		router.emitOutput({ type: "message_finished", piboSessionId: "ps_waiter", eventId: "message-cancelled" });
		assert.equal(settled, false);

		confirmCancellation();
		await assert.rejects(waiting, (error) => error instanceof Error && error.name === "AbortError" && error.message === "Subagent request was aborted.");
	});
});

test("session reply waiter cancels only the requested message when two requests share a child session", async () => {
	await withRouter(async (router) => {
		const cancellations = [];
		router.emit = async (event) => ({ type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: event.id === "request-a" ? 0 : 1, text: event.text, source: event.source });
		router.cancelSessionMessage = async (piboSessionId, eventId) => { cancellations.push({ piboSessionId, eventId }); };
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = router.emitMessageAndWaitForReply({ type: "message", piboSessionId: "ps_shared", id: "request-a", text: "A", source: "actor" }, undefined, firstController.signal);
		const second = router.emitMessageAndWaitForReply({ type: "message", piboSessionId: "ps_shared", id: "request-b", text: "B", source: "actor" }, undefined, secondController.signal);
		await new Promise((resolve) => setImmediate(resolve));

		secondController.abort();
		await assert.rejects(second, (error) => error instanceof Error && error.name === "AbortError");
		assert.deepEqual(cancellations, [{ piboSessionId: "ps_shared", eventId: "request-b" }]);

		router.emitOutput({ type: "assistant_message", piboSessionId: "ps_shared", eventId: "request-a", text: "A completed" });
		router.emitOutput({ type: "message_finished", piboSessionId: "ps_shared", eventId: "request-a" });
		assert.equal((await first).text, "A completed");
		assert.equal(firstController.signal.aborted, false);
	});
});

test("session reply waiter reports failed targeted cancellation instead of confirming abort", async () => {
	await withRouter(async (router) => {
		router.emit = async (event) => ({ type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source });
		router.cancelSessionMessage = async () => { throw new Error("provider abort failed"); };
		const controller = new AbortController();
		const waiting = router.emitMessageAndWaitForReply({ type: "message", piboSessionId: "ps_waiter", id: "request-failed-cancel", text: "work", source: "actor" }, undefined, controller.signal);
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		await assert.rejects(waiting, (error) => (
			error instanceof Error
			&& error.name === "PiboRunCancellationError"
			&& /Failed to cancel subagent request/.test(error.message)
			&& error.cause instanceof Error
			&& error.cause.message === "provider abort failed"
		));
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

test("session reply waiter classifies timeout after the child confirms targeted termination", async () => {
	await withRouter(async (router) => {
		const cancellations = [];
		let confirmCancellation;
		router.emit = async (event) => ({ type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source });
		router.cancelSessionMessage = async (piboSessionId, eventId) => {
			cancellations.push({ piboSessionId, eventId });
			await new Promise((resolve) => { confirmCancellation = resolve; });
		};
		let settled = false;
		const waiting = router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_waiter",
			id: "message-3",
			text: "work",
			source: "actor",
		}, 10).finally(() => { settled = true; });

		const deadline = Date.now() + 1_000;
		while (!confirmCancellation) {
			if (Date.now() >= deadline) throw new Error("Timed out waiting for targeted child cancellation");
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.equal(settled, false);
		confirmCancellation();
		await assert.rejects(waiting, (error) => (
			error instanceof PiboRunExecutionTimeoutError
			&& error.timeoutPhase === "lifetime"
			&& /Timed out waiting for assistant reply/.test(error.message)
		));
		assert.deepEqual(cancellations, [{ piboSessionId: "ps_waiter", eventId: "message-3" }]);
	});
});
