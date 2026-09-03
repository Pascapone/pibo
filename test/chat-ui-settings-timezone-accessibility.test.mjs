import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("General settings associates the visible App timezone label with its selector", async () => {
	const source = await readFile(new URL("../src/apps/chat-ui/src/settings/SettingsView.tsx", import.meta.url), "utf8");
	assert.match(source, /<label htmlFor="app-timezone"[^>]*>App timezone<\/label>/);
	assert.match(source, /<select\s+id="app-timezone"/);
});
