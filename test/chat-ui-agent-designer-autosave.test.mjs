import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const agentsViewSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/AgentsView.tsx"), "utf8");
const appSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/App.tsx"), "utf8");
const modelSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/agent-designer-model.ts"), "utf8");

test("Agent Designer debounces autosave and serializes overlapping writes", () => {
	assert.match(agentsViewSource, /const AGENT_AUTOSAVE_DELAY_MS = 900/);
	assert.match(agentsViewSource, /window\.setTimeout\([\s\S]*persistIfNeeded\(\)[\s\S]*AGENT_AUTOSAVE_DELAY_MS/);
	assert.match(agentsViewSource, /savePromiseRef\.current[\s\S]*await savePromiseRef\.current[\s\S]*return persistIfNeeded\(\)/);
	assert.match(agentsViewSource, /shouldSaveAgain = agentDraftSignature\(nextDraft\) !== submittedSignature/);
	assert.match(agentsViewSource, /snapshot\.id \? await patchCustomAgent\(snapshot\.id, input\) : await postCustomAgent\(input\)/);
	assert.match(agentsViewSource, /if \(!snapshot\.id\)[\s\S]*await getCustomAgents\(\)[\s\S]*agentDraftSignature\(agentToDraft\(agent\)\) === submittedSignature/);
	assert.match(agentsViewSource, /onFocus=\{\(\) => setEditingName\(true\)\}[\s\S]*onBlur=\{\(\) => setEditingName\(false\)\}/);
	assert.match(modelSource, /const uniqueNames = [\s\S]*new Set[\s\S]*name\.trim\(\)/);
	assert.match(modelSource, /const name = item\.name\.trim\(\)[\s\S]*const targetProfile = item\.targetProfile\.trim\(\)/);
});

test("Agent Designer keeps pending edits recoverable and exposes save state instead of a Save button", () => {
	assert.match(agentsViewSource, /PENDING_AGENT_DRAFT_STORAGE_KEY/);
	assert.match(agentsViewSource, /writePendingAgentDraft\(draft, savedSignatureRef\.current\)/);
	assert.match(agentsViewSource, /data-agent-autosave-state=\{saveState\}/);
	assert.match(agentsViewSource, />\s*Retry\s*</);
	assert.doesNotMatch(agentsViewSource, /title="Save Agent"/);
});

test("navigation away from Agent Designer waits for a successful autosave", () => {
	assert.match(appSource, /useBlocker\(\{/);
	assert.match(appSource, /disabled: area !== "agents"/);
	assert.match(appSource, /await autosave\(\)[\s\S]*return false[\s\S]*catch[\s\S]*return true/);
	assert.match(appSource, /onAutosaveHandlerChange=\{updateAgentAutosaveHandler\}/);
});
