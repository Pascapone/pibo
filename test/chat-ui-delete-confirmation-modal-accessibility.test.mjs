import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("session and room delete confirmations use the shared labelled modal contract", async () => {
	const source = await readFile("src/apps/chat-ui/src/delete-confirmation-modals.tsx", "utf8");
	const sessionModal = source.slice(source.indexOf("export function DeleteSessionModal"), source.indexOf("export function DeleteRoomModal"));
	const roomModal = source.slice(source.indexOf("export function DeleteRoomModal"));

	assert.match(source, /import \{ DialogShell \} from "\.\/components\/DialogShell"/);
	assert.equal((source.match(/<DialogShell\b/g) ?? []).length, 2);
	assert.doesNotMatch(source, /autoFocus/);

	assert.match(sessionModal, /<DialogShell[\s\S]*title="Delete Session"/);
	assert.match(sessionModal, /description=\{session\.piboSessionId\}/);
	assert.match(sessionModal, /initialFocusRef=\{confirmInputRef\}/);
	assert.match(sessionModal, /closeDisabled=\{deleting\}/);
	assert.match(sessionModal, /<input[\s\S]*ref=\{confirmInputRef\}/);

	assert.match(roomModal, /<DialogShell[\s\S]*title="Delete Room"/);
	assert.match(roomModal, /description=\{room\.id\}/);
	assert.match(roomModal, /initialFocusRef=\{confirmInputRef\}/);
	assert.match(roomModal, /closeDisabled=\{deleting\}/);
	assert.match(roomModal, /<input[\s\S]*ref=\{confirmInputRef\}/);
});

test("action selection restores its menu trigger before opening a confirmation", async () => {
	const script = String.raw`
		import assert from "node:assert/strict";
		import { completeActionMenuSelection } from "./src/apps/chat-ui/src/action-menu.tsx";

		const calls = [];
		completeActionMenuSelection(
			() => calls.push("close menu"),
			() => calls.push("restore trigger"),
			() => calls.push("open confirmation"),
		);
		assert.deepEqual(calls, ["close menu", "restore trigger", "open confirmation"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
