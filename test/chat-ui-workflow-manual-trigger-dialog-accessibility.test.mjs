import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"), "utf8");

test("Workflow manual-trigger dialog manages keyboard focus and dismissal", () => {
	assert.match(source, /manualTriggerInvokerRef\.current = document\.activeElement instanceof HTMLElement \? document\.activeElement : null/);
	assert.match(source, /useLayoutEffect\(\(\) => \{\s*if \(!manualTriggerDialog\) return;\s*manualTriggerInputRef\.current\?\.focus\(\)/);
	assert.match(source, /if \(event\.key !== "Escape" \|\| manualTriggerDialog\?\.status === "running"\) return/);
	assert.match(source, /onKeyDown=\{handleManualTriggerDialogKeyDown\}/);
	assert.match(source, /textarea ref=\{manualTriggerInputRef\}/);
	assert.match(source, /onClick=\{closeManualTriggerDialog\}/);
	assert.match(source, /requestAnimationFrame\(\(\) => invoker\?\.focus\(\)\)/);
});

test("manual triggers expose their Room and send its identity through the ordinary run API", () => {
	assert.match(source, /aria-label="Run Room"/);
	assert.match(source, /Workspace: \{manualTriggerRoom\?\.workspace/);
	assert.match(source, /roomId: manualTriggerDialog\.roomId/);
	const browserEntry = readFileSync(join(process.cwd(), "src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx"), "utf8");
	const workflowsArea = readFileSync(join(process.cwd(), "src/apps/chat-ui/src/WorkflowsArea.tsx"), "utf8");
	assert.match(browserEntry, /<WorkflowsArea room=\{bootstrap\.room\}/);
	assert.match(workflowsArea, /<WorkflowBuilderDraftLoader draftId=\{draftId\} room=\{room\}/);
	assert.match(workflowsArea, /<WorkflowGraphCanvas[\s\S]*room=\{room\}/);
});
