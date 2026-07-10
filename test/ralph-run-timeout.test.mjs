import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboRalphService } from "../dist/ralph/service.js";
import { PiboRalphStore } from "../dist/ralph/store.js";

function createContext() {
	const listeners = new Set();
	const emitted = [];
	return {
		emitted,
		context: {
			async emit(event) { emitted.push(event); },
			subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		},
		finish(text = "done") {
			const message = emitted.find((event) => event.type === "message");
			assert.ok(message);
			for (const listener of listeners) {
				listener({ type: "assistant_message", piboSessionId: message.piboSessionId, eventId: message.id, text });
				listener({ type: "message_finished", piboSessionId: message.piboSessionId, eventId: message.id });
			}
		},
		fail(error = "session failed") {
			const message = emitted.find((event) => event.type === "message");
			assert.ok(message);
			for (const listener of listeners) {
				listener({ type: "session_error", piboSessionId: message.piboSessionId, eventId: message.id, error });
			}
		},
	};
}

async function createService(runTimeoutMs) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-run-timeout-"));
	const controlled = createContext();
	const service = new PiboRalphService({
		store: new PiboRalphStore({ path: ":memory:" }),
		context: controlled.context,
		dataStorePath: join(dir, "data.sqlite"),
		dataPayloadRootDir: join(dir, "payloads"),
		...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
	});
	return {
		service,
		controlled,
		async cleanup() {
			service.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

test("Ralph runs do not schedule a timeout by default", async () => {
	const fixture = await createService();
	const originalSetTimeout = globalThis.setTimeout;
	let scheduledTimeouts = 0;
	try {
		globalThis.setTimeout = (...args) => {
			scheduledTimeouts += 1;
			return originalSetTimeout(...args);
		};
		const waiting = fixture.service.emitMessageAndWait("ps_unlimited", "work");
		globalThis.setTimeout = originalSetTimeout;

		assert.equal(scheduledTimeouts, 0);
		fixture.controlled.finish("complete");
		assert.equal(await waiting, "complete");
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		await fixture.cleanup();
	}
});

test("Ralph keeps waiting after a session error so Pi can retry", async () => {
	const fixture = await createService();
	try {
		let settled = false;
		const waiting = fixture.service.emitMessageAndWait("ps_retry", "work").finally(() => { settled = true; });
		fixture.controlled.fail("provider unavailable");
		await Promise.resolve();
		assert.equal(settled, false);

		fixture.controlled.finish("recovered");
		assert.equal(await waiting, "recovered");
	} finally {
		await fixture.cleanup();
	}
});

test("Ralph still supports an explicitly configured run timeout", async () => {
	const fixture = await createService(20);
	try {
		await assert.rejects(
			fixture.service.emitMessageAndWait("ps_limited", "work"),
			/Ralph run timed out/,
		);
	} finally {
		await fixture.cleanup();
	}
});
