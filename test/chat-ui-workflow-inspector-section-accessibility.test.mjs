import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"), "utf8");

test("Workflow inspector section navigation exposes the current section", () => {
	assert.match(source, /<nav[^>]+aria-label="Workflow inspector sections"/);
	assert.match(source, /aria-pressed=\{inspectorTab === tab\.id\}/);
	assert.match(source, /onClick=\{\(\) => setInspectorTab\(tab\.id\)\}/);
});
