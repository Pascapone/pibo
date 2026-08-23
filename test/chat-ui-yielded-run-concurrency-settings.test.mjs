import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Chat settings expose gateway and per-session yielded-run concurrency", async () => {
	const [view, sidebar] = await Promise.all([
		readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/settings/SettingsSidebar.tsx", "utf8"),
	]);
	assert.match(sidebar, /onSelect\("concurrency"\)/);
	assert.match(view, /gateway-concurrent-yielded-runs/);
	assert.match(view, /session-concurrent-yielded-runs/);
	assert.match(view, /patchGatewaySettings/);
	assert.match(view, /Default: 50 across this gateway/);
	assert.match(view, /Default: 10 for each controlling session/);
});
