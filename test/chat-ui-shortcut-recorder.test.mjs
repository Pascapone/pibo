import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runShortcutScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { shortcutFromKeyboardEvent } = await import("./src/apps/chat-ui/src/web-annotation-storage.ts");
		const event = (overrides) => ({ key: "a", code: "KeyA", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides });

		assert.equal(shortcutFromKeyboardEvent(event({})), null);
		assert.equal(shortcutFromKeyboardEvent(event({ shiftKey: true })), null);
		assert.equal(shortcutFromKeyboardEvent(event({ key: "Escape", code: "Escape" })), null);
		assert.equal(shortcutFromKeyboardEvent(event({ altKey: true, shiftKey: true })), "Alt+Shift+A");
		assert.equal(shortcutFromKeyboardEvent(event({ key: " ", code: "Space", ctrlKey: true })), "Ctrl+Space");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("shortcut recorder requires Ctrl, Alt, or Meta", async () => {
	await assert.doesNotReject(runShortcutScenario());
});

test("shortcut recorder cancels Escape and explains rejected keys", () => {
	const source = readFileSync("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	assert.match(source, /event\.key === "Escape"[\s\S]*setRecording\(false\)/);
	assert.match(source, /Use Ctrl, Alt, or Meta with another key\./);
});
