import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider settings and model surfaces are runtime-catalog driven instead of a hard-coded global provider list", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/ProviderSettingsView.tsx", "utf8");
	const designerModel = await readFile("src/apps/chat-ui/src/agents/agent-designer-model.ts", "utf8");
	const terminalModel = await readFile("src/apps/chat-ui/src/session-views/compact-terminal/TerminalModelCard.tsx", "utf8");

	assert.match(source, /getProviderAuthCatalog/);
	assert.match(source, /catalog\?\.targets\.map/);
	assert.match(source, /target\.runtimeInstanceId/);
	assert.match(source, /target\.credentialScope/);
	for (const state of ["connected", "disconnected", "pending", "partial", "unsupported", "failed"]) {
		assert.match(source, new RegExp(`\\b${state}\\b`));
	}
	assert.doesNotMatch(source, /const\s+PROVIDERS\s*=/);
	assert.doesNotMatch(source, /Anthropic \(Claude\).*authMethod/);
	assert.match(designerModel, /runtimeRequiresAuth/);
	assert.match(designerModel, /auth\?\.configured \?\? optionAuthConfigured \?\? !runtimeRequiresAuth/);
	assert.match(terminalModel, /model\.authConfigured === false/);
	assert.match(terminalModel, /Provider authentication missing/);
});
