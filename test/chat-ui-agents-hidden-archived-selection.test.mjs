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
	const end = source.indexOf("\n\tconst setDraftArchived", start);
	if (end < 0) throw new Error("toggleArchivedAgents handler end not found");
	return source.slice(start, end);
}

test("hiding archived agents switches the designer away from a hidden archived selection", () => {
	const handler = archivedAgentToggleHandler();
	assert.match(handler, /if \(next \|\| !archivedDraft\) return;/);
	assert.match(handler, /const nextDraft = selectExistingAgentDraft\(agents, customAgents, catalog \?\? undefined\);/);
	assert.match(handler, /activateDraft\(nextDraft, agentDraftSignature\(nextDraft\), false\);/);
	assert.match(handler, /if \(nextDraft\.profileName\) onSelect\(nextDraft\.profileName\);/);
});

test("the archived-agent visibility control uses the reconciled toggle handler", () => {
	assert.match(source, /onToggleArchivedAgents=\{toggleArchivedAgents\}/);
});
