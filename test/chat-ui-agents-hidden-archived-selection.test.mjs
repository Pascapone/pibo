import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const agentsViewPath = resolve(here, "../src/apps/chat-ui/src/agents/AgentsView.tsx");
const source = readFileSync(agentsViewPath, "utf8");

function archivedAgentToggleHandler() {
	const start = source.indexOf("const toggleArchivedAgents = () => {");
	if (start < 0) throw new Error("toggleArchivedAgents handler not found");
	const end = source.indexOf("\n\tconst createNewAgentDraft", start);
	if (end < 0) throw new Error("toggleArchivedAgents handler end not found");
	return source.slice(start, end);
}

test("hiding archived agents switches the designer away from a hidden archived selection", () => {
	const handler = archivedAgentToggleHandler();
	assert.match(handler, /if \(next \|\| !archivedDraft\) return;/);
	assert.match(handler, /const fallbackCustomAgent = activeCustomAgents\[0\];/);
	assert.match(handler, /setDraft\(agentToDraft\(fallbackCustomAgent\)\);/);
	assert.match(handler, /onSelect\(fallbackCustomAgent\.profileName\);/);
	assert.match(handler, /const fallbackProfile = pluginProfiles\[0\];/);
	assert.match(handler, /setDraft\(profileToDraft\(fallbackProfile, catalog \?\? undefined\)\);/);
	assert.match(handler, /onSelect\(fallbackProfile\.name\);/);
});

test("the archived-agent visibility button uses the reconciled toggle handler", () => {
	assert.match(source, /onClick=\{toggleArchivedAgents\}/);
});
