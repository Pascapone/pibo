import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default tool bundles use a single-click outer disclosure and double-click child details", async () => {
	const source = await readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
	assert.match(source, /data-pibo-tool-call-group="true"/);
	assert.match(source, /data-pibo-tool-call-group-trigger="true"[\s\S]*?onClick=\{handleRowToggle\}[\s\S]*?aria-expanded=\{expanded\}/);
	assert.match(source, /expanded \? <ChevronDown[\s\S]*?: <ChevronRight/);
	assert.match(source, /row\.groupRows\?\.at\(-1\) \?\? row/, "the collapsed bundle header must always show the newest tool call");
	assert.match(source, /data-pibo-tool-call-group-children="true"/);
	assert.match(source, /data-pibo-tool-call-group-child="true"[\s\S]*?disclosureMode="double"/);
	assert.match(source, /onDoubleClick=\{row\.expandable && disclosureMode === "double" \? handleRowToggle : undefined\}/);
	assert.match(source, /ml-5 mt-2 border-l border-\[#2a2a2a\] pl-2/, "expanded Slim rows should be visibly nested");
});
