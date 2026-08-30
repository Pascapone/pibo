import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const agentsViewSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/AgentsView.tsx"), "utf8");
const appSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/App.tsx"), "utf8");
const modelSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/agent-designer-model.ts"), "utf8");
const designerUiSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/agents/designer-ui.tsx"), "utf8");

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

test("Agent Designer clears stale validation errors when the agent name changes", () => {
	assert.match(agentsViewSource, /value=\{draft\.displayName\}[\s\S]{0,400}onChange=\{\(event\) => \{[\s\S]{0,120}setLocalError\(null\)[\s\S]{0,160}displayName: event\.target\.value[\s\S]{0,80}\}\}/);
});

test("Agent Designer cannot restore an invalid persisted agent name", () => {
	assert.match(agentsViewSource, /const draft: AgentDraft = \{[\s\S]{0,900}validateAgentName\(draft\.displayName\)[\s\S]{0,240}sessionStorage\.removeItem\(PENDING_AGENT_DRAFT_STORAGE_KEY\)[\s\S]{0,120}return null/);
});

test("Agent Designer cancels stale autosave timers and does not persist unfinished name edits", () => {
	assert.match(agentsViewSource, /const signature = agentDraftSignature\(draft\)[\s\S]{0,500}clearAutosaveTimer\(\)[\s\S]{0,240}const nameError = validateAgentName\(draft\.displayName\)[\s\S]{0,240}if \(editingName \|\| nameError\) return[\s\S]{0,160}writePendingAgentDraft\(draft, savedSignatureRef\.current\)/);
});

test("Agent Designer keeps pending edits recoverable and exposes save state instead of a Save button", () => {
	assert.match(agentsViewSource, /PENDING_AGENT_DRAFT_STORAGE_KEY/);
	assert.match(agentsViewSource, /typeof parsed\.draft\.nativeSubagents === "boolean"/);
	assert.match(agentsViewSource, /writePendingAgentDraft\(draft, savedSignatureRef\.current\)/);
	assert.match(agentsViewSource, /data-agent-autosave-state=\{saveState\}/);
	assert.match(agentsViewSource, />\s*Retry\s*</);
	assert.doesNotMatch(agentsViewSource, /title="Save Agent"/);
});

test("Agent Designer persists runtime selection, validates JSON options, and shows runtime diagnostics", () => {
	assert.match(modelSource, /runtimeInstanceId: \(draft\.runtimeInstanceId \?\? "pi"\)\.trim\(\) \|\| "pi"/);
	assert.match(modelSource, /\? structuredClone\(draft\.runtimeOptions\)[\s\S]*: \{\}/);
	assert.match(agentsViewSource, /<AgentRuntimeSelector/);
	assert.match(agentsViewSource, /runtimeOptionsErrorRef\.current/);
	assert.match(designerUiSource, /Agent Runtime/);
	assert.match(designerUiSource, /Effective runtime capabilities/);
	assert.match(designerUiSource, /Options are validated by the selected runtime before saving/);
	assert.match(designerUiSource, /Schema generated runtime options/);
	assert.match(designerUiSource, /runtimeOptionFields\(schema\)/);
	assert.match(designerUiSource, /disabled=\{!runtime\.available && runtime\.id !== runtimeInstanceId\}/);
	assert.match(agentsViewSource, /Existing selections remain visible so they can be removed/);
	assert.match(agentsViewSource, /unsupportedDeliveryReason/);
	assert.match(agentsViewSource, /modelCatalogForRuntime\(selectedRuntime, modelCatalog\)/);
	assert.match(modelSource, /runtime\.models\.models/);
	assert.match(modelSource, /reasoningOptions = model\.reasoningOptions\?\.filter/);
	assert.match(modelSource, /export function reasoningValuesForModel/);
	assert.match(agentsViewSource, /reasoningValuesForModel\(selectedRuntime\?\.capabilities\.reasoning\.values, runtimeModelCatalog, draft\.mainModel\)/);
	assert.match(agentsViewSource, /reasoningValuesForModel\(runtime\?\.capabilities\.reasoning\.values, targetModelCatalog, subagent\.model\)/);
});

test("Agent Designer exposes ordered drag-and-drop provider fallback lists", () => {
	assert.match(agentsViewSource, /modelFallbacks=\{draft\.mainModelFallbacks\}/);
	assert.match(agentsViewSource, /onModelFallbacksChange=\{\(mainModelFallbacks\)/);
	assert.match(designerUiSource, /data-provider-fallback-list/);
	assert.match(designerUiSource, /title="Add fallback provider"/);
	assert.match(designerUiSource, /draggable=\{!readOnly && rows\.length > 1\}/);
	assert.match(designerUiSource, /onDrop=\{\(event\) =>/);
	assert.match(designerUiSource, /moveRow\(index, index - 1\)/);
	assert.match(designerUiSource, /Provider requests follow this order from top to bottom\./);
});

test("Agent Designer exposes only truthful runtime-owned context and native-subagent controls", () => {
	assert.match(agentsViewSource, /nativeSubagents\?\.configurable \? \(/);
	assert.match(agentsViewSource, /title="Native Subagents"/);
	assert.match(agentsViewSource, /contextDiscovery\?\.supported \? \(/);
	assert.match(agentsViewSource, /disabled=\{readOnly \|\| !contextDiscovery\.configurable/);
	assert.match(agentsViewSource, /discovers project context files natively; Pibo cannot override this setting/);
	assert.match(agentsViewSource, /nativeSubagents: undefined/);
	assert.match(agentsViewSource, /!nextRuntime\.capabilities\.contextDiscovery\.configurable[\s\S]*autoContextFiles: true/);
	assert.match(modelSource, /nativeSubagents: draft\.nativeSubagents \?\? null/);
});

test("Agent Designer keeps Pibo subagents and yielded subagent runs capability-gated", () => {
	assert.match(agentsViewSource, /<SubagentDesigner[\s\S]*capabilityUnavailableReason=\{piboToolsUnavailableReason\}/);
	assert.match(agentsViewSource, /title="pibo-run-control"[\s\S]*Pibo-managed tools and subagents/);
	assert.match(agentsViewSource, /Private harness-native tools are included only when the runtime declares native-tool yielding/);
});

test("Agent Designer exposes goal lifecycle tooling as a default-enabled package switch", () => {
	assert.match(agentsViewSource, /title="pibo-goal-control"/);
	assert.match(agentsViewSource, /checked=\{draft\.goalControl\}/);
	assert.match(agentsViewSource, /goalControl: !current\.goalControl/);
	assert.match(modelSource, /goalControl: true/);
	assert.match(modelSource, /goalControl: draft\.goalControl/);
});

test("navigation away from Agent Designer waits for a successful autosave", () => {
	assert.match(appSource, /useBlocker\(\{/);
	assert.match(appSource, /disabled: area !== "agents"/);
	assert.match(appSource, /await autosave\(\)[\s\S]*return false[\s\S]*catch[\s\S]*return true/);
	assert.match(appSource, /onAutosaveHandlerChange=\{updateAgentAutosaveHandler\}/);
});
