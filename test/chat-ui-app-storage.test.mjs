import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppStorageScenario() {
	const script = `
		import assert from "node:assert/strict";
		const storage = new Map();
		globalThis.localStorage = {
			getItem(key) {
				return storage.has(key) ? storage.get(key) : null;
			},
			setItem(key, value) {
				storage.set(key, String(value));
			},
			removeItem(key) {
				storage.delete(key);
			},
		};
		const {
			readStoredExpandThinking,
			readStoredNewSessionProfile,
			readStoredShowArchivedRooms,
			readStoredShowArchivedSessions,
			readStoredShowRawEvents,
			readStoredShowThinking,
			readStoredToolDisplayMode,
			removeStoredNewSessionProfile,
			removeStoredRoomSelection,
			writeStoredExpandThinking,
			writeStoredNewSessionProfile,
			writeStoredShowArchivedRooms,
			writeStoredShowArchivedSessions,
			writeStoredShowRawEvents,
			writeStoredShowThinking,
			writeStoredToolDisplayMode,
		} = await import("./src/apps/chat-ui/src/app-storage.ts");

		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredExpandThinking(), true);
		assert.equal(readStoredShowRawEvents(), false);
		assert.equal(readStoredToolDisplayMode(), "default");
		assert.equal(readStoredShowArchivedSessions(), false);
		assert.equal(readStoredShowArchivedRooms(), false);
		assert.equal(readStoredNewSessionProfile(), "");
		assert.equal(readStoredNewSessionProfile("room-a"), "");

		writeStoredShowThinking(false);
		writeStoredExpandThinking(false);
		writeStoredShowRawEvents(true);
		writeStoredToolDisplayMode("intent");
		writeStoredShowArchivedSessions(true);
		writeStoredShowArchivedRooms(true);
		writeStoredNewSessionProfile("pibo-agent");
		writeStoredNewSessionProfile("agent-a", "room-a");
		writeStoredNewSessionProfile("agent-b", "room-b");

		assert.equal(readStoredShowThinking(), false);
		assert.equal(readStoredExpandThinking(), false);
		assert.equal(readStoredShowRawEvents(), true);
		assert.equal(readStoredToolDisplayMode(), "intent");
		assert.equal(readStoredShowArchivedSessions(), true);
		assert.equal(readStoredShowArchivedRooms(), true);
		assert.equal(readStoredNewSessionProfile(), "pibo-agent");
		assert.equal(readStoredNewSessionProfile("room-a"), "agent-a");
		assert.equal(readStoredNewSessionProfile("room-b"), "agent-b");
		removeStoredRoomSelection("room-a");
		assert.equal(readStoredNewSessionProfile("room-a"), "agent-a");
		removeStoredNewSessionProfile("room-a");
		assert.equal(readStoredNewSessionProfile("room-a"), "");
		assert.equal(readStoredNewSessionProfile("room-b"), "agent-b");

		storage.set("pibo.chat.showThinking", "unexpected");
		storage.set("pibo.chat.showRawEvents", "unexpected");
		storage.set("pibo.chat.toolDisplayMode", "unexpected");
		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredShowRawEvents(), false);
		assert.equal(readStoredToolDisplayMode(), "default");

		globalThis.localStorage = {
			getItem() { throw new Error("blocked"); },
			setItem() { throw new Error("blocked"); },
			removeItem() { throw new Error("blocked"); },
		};
		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredShowRawEvents(), false);
		assert.equal(readStoredToolDisplayMode(), "default");
		assert.equal(readStoredNewSessionProfile(), "");
		assert.equal(readStoredNewSessionProfile("room-a"), "");
		assert.doesNotThrow(() => writeStoredShowThinking(false));
		assert.doesNotThrow(() => writeStoredToolDisplayMode("slim"));
		assert.doesNotThrow(() => writeStoredNewSessionProfile("other"));
		assert.doesNotThrow(() => writeStoredNewSessionProfile("other", "room-a"));
		assert.doesNotThrow(() => removeStoredNewSessionProfile("room-a"));
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app storage helpers own persisted display and profile preferences", async () => {
	await assert.doesNotReject(runAppStorageScenario());
});
