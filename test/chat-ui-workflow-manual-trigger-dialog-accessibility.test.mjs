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
