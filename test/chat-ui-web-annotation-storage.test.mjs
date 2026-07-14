import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWebAnnotationStorageScenario() {
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
			readStoredSelectedWebAnnotationIds,
			writeStoredSelectedWebAnnotationIds,
		} = await import("./src/apps/chat-ui/src/web-annotation-storage.ts");

		writeStoredSelectedWebAnnotationIds("ps-a", ["ann-1", "ann-2"]);
		assert.deepEqual(readStoredSelectedWebAnnotationIds("ps-b"), ["ann-1", "ann-2"]);
		assert.equal(storage.has("pibo.chat.webAnnotations.selected.ps-a"), false);

		writeStoredSelectedWebAnnotationIds("ps-b", ["ann-2"]);
		assert.deepEqual(readStoredSelectedWebAnnotationIds("ps-a"), ["ann-2"]);

		storage.delete("pibo.chat.webAnnotations.selected");
		storage.set("pibo.chat.webAnnotations.selected.ps-legacy", JSON.stringify(["ann-legacy"]));
		assert.deepEqual(readStoredSelectedWebAnnotationIds("ps-legacy"), ["ann-legacy"]);
		assert.deepEqual(readStoredSelectedWebAnnotationIds("ps-new"), ["ann-legacy"]);
		assert.equal(storage.has("pibo.chat.webAnnotations.selected.ps-legacy"), false);

		writeStoredSelectedWebAnnotationIds("ps-new", []);
		assert.deepEqual(readStoredSelectedWebAnnotationIds("ps-a"), []);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("web annotation attachment selection follows the active session", async () => {
	await assert.doesNotReject(runWebAnnotationStorageScenario());
});
