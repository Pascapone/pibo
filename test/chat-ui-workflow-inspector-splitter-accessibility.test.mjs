import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"), "utf8");

test("Workflow inspector resize handle exposes and implements splitter semantics", () => {
	assert.match(source, /role="separator"/);
	assert.match(source, /aria-orientation="vertical"/);
	assert.match(source, /aria-valuemin=\{INSPECTOR_MIN_WIDTH\}/);
	assert.match(source, /aria-valuemax=\{inspectorMaxWidth\(\)\}/);
	assert.match(source, /aria-valuenow=\{inspectorWidth\}/);
	assert.match(source, /onKeyDown=\{handleInspectorResizeKeyDown\}/);
	assert.match(source, /event\.key === "ArrowLeft"[\s\S]*inspectorWidth \+ INSPECTOR_KEYBOARD_STEP/);
	assert.match(source, /event\.key === "ArrowRight"[\s\S]*inspectorWidth - INSPECTOR_KEYBOARD_STEP/);
	assert.match(source, /event\.key === "Home"[\s\S]*INSPECTOR_MIN_WIDTH/);
	assert.match(source, /event\.key === "End"[\s\S]*inspectorMaxWidth\(\)/);
	assert.match(source, /setInspectorWidth\(clampInspectorWidth\(window\.innerWidth - moveEvent\.clientX - 32\)\)/);
});
