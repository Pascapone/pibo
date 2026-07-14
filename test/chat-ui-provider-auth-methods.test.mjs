import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Anthropic configuration uses the supported API key flow", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/ProviderSettingsView.tsx", "utf8");

	assert.match(source, /\{ id: "anthropic", name: "Anthropic \(Claude\)", authMethod: "api_key" \}/);
	assert.doesNotMatch(source, /\{ id: "anthropic",[^\n]+authMethod: "oauth"/);
});
