import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) =>
	(await readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

test("workflow edge adapter chooser uses the shared accessible dialog lifecycle", async () => {
	const inspectors = await source("workflows/WorkflowInspectorsPanel.tsx");
	const dialog = inspectors.match(/function WorkflowEdgeAdapterDialog[\s\S]*?(?=\nfunction WorkflowPortEditor)/)?.[0];

	assert.ok(dialog, "workflow edge adapter dialog must remain present");
	assert.match(inspectors, /import \{ DialogShell \} from "\.\.\/components\/DialogShell";/);
	assert.match(dialog, /<DialogShell/);
	assert.match(dialog, /title=\{`Choose a registered adapter for \$\{edgeId\}`\}/);
	assert.match(dialog, /description="The dialog shows the source output and target input schemas from the Pibo Workflow IR\."/);
	assert.match(dialog, /onClose=\{onClose\}/);
	assert.match(dialog, /closeLabel="Close compatible edge adapter dialog"/);
	assert.match(dialog, /closeDisabled=\{isSaving\}/);
	assert.match(dialog, /maxWidthClassName="max-w-3xl"/);
	assert.doesNotMatch(dialog, /role="dialog"/);
	assert.doesNotMatch(dialog, /aria-modal="true"/);
});
