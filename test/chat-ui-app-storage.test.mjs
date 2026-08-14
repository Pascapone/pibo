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
			readStoredHideTools,
			readStoredNewSessionProfile,
			readStoredShowArchivedRooms,
			readStoredShowArchivedSessions,
			readStoredShowRawEvents,
			readStoredShowThinking,
			removeStoredNewSessionProfile,
			removeStoredRoomSelection,
			writeStoredExpandThinking,
			writeStoredHideTools,
			writeStoredNewSessionProfile,
			writeStoredShowArchivedRooms,
			writeStoredShowArchivedSessions,
			writeStoredShowRawEvents,
			writeStoredShowThinking,
		} = await import("./src/apps/chat-ui/src/app-storage.ts");

		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredHideTools(), false);
		assert.equal(readStoredExpandThinking(), true);
		assert.equal(readStoredShowRawEvents(), false);
		assert.equal(readStoredShowArchivedSessions(), false);
		assert.equal(readStoredShowArchivedRooms(), false);
		assert.equal(readStoredNewSessionProfile(), "");
		assert.equal(readStoredNewSessionProfile("room-a"), "");

		writeStoredShowThinking(false);
		writeStoredHideTools(true);
		writeStoredExpandThinking(false);
		writeStoredShowRawEvents(true);
		writeStoredShowArchivedSessions(true);
		writeStoredShowArchivedRooms(true);
		writeStoredNewSessionProfile("pibo-agent");
		writeStoredNewSessionProfile("agent-a", "room-a");
		writeStoredNewSessionProfile("agent-b", "room-b");

		assert.equal(readStoredShowThinking(), false);
		assert.equal(readStoredHideTools(), true);
		assert.equal(readStoredExpandThinking(), false);
		assert.equal(readStoredShowRawEvents(), true);
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
		storage.set("pibo.chat.hideTools", "unexpected");
		storage.set("pibo.chat.showRawEvents", "unexpected");
		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredHideTools(), false);
		assert.equal(readStoredShowRawEvents(), false);

		globalThis.localStorage = {
			getItem() { throw new Error("blocked"); },
			setItem() { throw new Error("blocked"); },
			removeItem() { throw new Error("blocked"); },
		};
		assert.equal(readStoredShowThinking(), true);
		assert.equal(readStoredHideTools(), false);
		assert.equal(readStoredShowRawEvents(), false);
		assert.equal(readStoredNewSessionProfile(), "");
		assert.equal(readStoredNewSessionProfile("room-a"), "");
		assert.doesNotThrow(() => writeStoredShowThinking(false));
		assert.doesNotThrow(() => writeStoredHideTools(true));
		assert.doesNotThrow(() => writeStoredNewSessionProfile("other"));
		assert.doesNotThrow(() => writeStoredNewSessionProfile("other", "room-a"));
		assert.doesNotThrow(() => removeStoredNewSessionProfile("room-a"));
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app storage helpers own persisted display and profile preferences", async () => {
	await assert.doesNotReject(runAppStorageScenario());
});
