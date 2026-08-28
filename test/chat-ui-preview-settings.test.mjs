import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Chat Web composes Preview settings with current concurrency, transcription, and speech settings", () => {
	const view = readFileSync("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	const sidebar = readFileSync("src/apps/chat-ui/src/settings/SettingsSidebar.tsx", "utf8");
	const api = readFileSync("src/apps/chat-ui/src/api-settings.ts", "utf8");
	assert.match(sidebar, /onSelect\("concurrency"\)/);
	assert.match(sidebar, /onSelect\("previews"\)/);
	assert.match(sidebar, /onSelect\("transcription"\)/);
	assert.match(sidebar, /onSelect\("speech"\)/);
	assert.match(view, /Maximum running servers/);
	assert.match(view, /Automatic stop after each start/);
	assert.match(view, /fixed runtime lease, not an inactivity timer/);
	assert.match(view, /maxRunningServers < 1 \|\| maxRunningServers > 20/);
	assert.match(view, /autoStopMinutes < 1 \|\| autoStopMinutes > 1440/);
	assert.match(api, /previewServers:\s*\{\s*maxRunningServers: number;\s*autoStopMinutes: number;/);
});
