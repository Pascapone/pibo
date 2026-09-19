import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const agentsViewSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/AgentsView.tsx"), "utf8");
const appSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/App.tsx"), "utf8");

test("Agent Designer can revert an unsavable draft to the last saved state", () => {
	assert.match(agentsViewSource, /const revertToSaved = async \(\) => \{/);
	assert.match(agentsViewSource, /if \(snapshot\.source !== "custom" \|\| snapshot\.archivedAt \|\| reverting\) return/);
	assert.match(agentsViewSource, /const refreshed = await getCustomAgents\(\)/);
	assert.match(agentsViewSource, /refreshed\.agents\.find\(\(agent\) => agent\.id === snapshot\.id\)/);
	assert.match(agentsViewSource, /const nextDraft = agentToDraft\(latest\)/);
	assert.match(agentsViewSource, /selectExistingAgentDraft\(agents, customAgentsRef\.current, catalogRef\.current \?\? undefined\)/);
	assert.match(agentsViewSource, /activateDraft\(nextDraft, agentDraftSignature\(nextDraft\)/);
});

test("Agent Designer exposes Revert next to Retry while changes are unsaved or failed", () => {
	assert.match(agentsViewSource, /\(saveState === "idle" \|\| saveState === "error"\) && !readOnly/);
	assert.match(agentsViewSource, /title="Revert to Last Saved"/);
	assert.match(agentsViewSource, /aria-label="Revert to Last Saved"/);
	assert.match(agentsViewSource, /onClick=\{\(\) => void revertToSaved\(\)\}/);
	assert.match(agentsViewSource, /reverting \? "Reverting…" : "Revert"/);
});

test("navigation and tab-close guards point at Revert when autosave fails", () => {
	const matches = appSource.match(/use Revert in the Agent Designer to discard the unsaved changes/g) ?? [];
	assert.equal(matches.length, 2);
});
