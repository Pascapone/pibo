import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runComposerScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { isSessionComposerDisabled } = await import("./src/apps/chat-ui/src/app-session-model.ts");
		const { selectedSessionBackendId } = await import("./src/apps/chat-ui/src/selected-session-backend.ts");

		const optimisticId = "optimistic-session-web-create";
		const persistedId = "ps-persisted";
		assert.equal(isSessionComposerDisabled(null, false), true);
		assert.equal(isSessionComposerDisabled(optimisticId, false), true);
		assert.equal(isSessionComposerDisabled(optimisticId, true), true);
		assert.equal(isSessionComposerDisabled(persistedId, true), true);
		assert.equal(isSessionComposerDisabled(persistedId, false), false);
		assert.equal(selectedSessionBackendId(optimisticId), null);
		assert.equal(selectedSessionBackendId(persistedId), persistedId);

		const dispatched = [];
		const attemptSend = (piboSessionId, selectedRoomArchived, text) => {
			if (isSessionComposerDisabled(piboSessionId, selectedRoomArchived) || !piboSessionId) return;
			dispatched.push({ piboSessionId, text });
		};
		attemptSend(optimisticId, false, "must stay local");
		attemptSend(persistedId, false, "send while another session is being created");
		attemptSend(persistedId, true, "archived room must stay blocked");
		assert.deepEqual(dispatched, [{
			piboSessionId: persistedId,
			text: "send while another session is being created",
		}]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("composer blocks only absent, synthetic, or archived selections", async () => {
	await runComposerScenario();
});

test("composer integration keeps backend guards and persisted-session concurrency", async () => {
	const [appSource, paneSource] = await Promise.all([
		readFile("src/apps/chat-ui/src/App.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8"),
	]);

	assert.match(appSource, /const selectedBackendPiboSessionId = selectedSessionBackendId\(selectedPiboSessionId\)/);
	assert.match(appSource, /if \(isSessionComposerDisabled\(selectedPiboSessionId, selectedRoomArchived\) \|\| !selectedPiboSessionId\) return;/);
	assert.match(paneSource, /const selectedBackendPiboSessionId = selectedSessionBackendId\(selectedPiboSessionId\)/);
	assert.match(paneSource, /selectedPiboSessionId: selectedBackendPiboSessionId/);
	assert.match(paneSource, /const composerDisabled = isSessionComposerDisabled\(\s*selectedPiboSessionId,\s*selectedRoomArchived,\s*\)/);
	assert.match(paneSource, /if \(composerDisabled \|\| !selectedPiboSessionId\) return;/);
	assert.match(paneSource, /disabled: composerDisabled,/);
	assert.doesNotMatch(paneSource, /isSessionComposerDisabled\([^)]*creatingSession/);
});
