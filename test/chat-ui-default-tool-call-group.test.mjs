import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default tool bundles expose their live count and use single-click child details", async () => {
	const source = await readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
	const traceSource = await readFile("src/apps/chat-ui/src/tracing/SpanNode.tsx", "utf8");
	assert.match(source, /data-pibo-tool-call-group="true"/);
	assert.match(source, /data-pibo-tool-call-group-trigger="true"[\s\S]*?onClick=\{handleRowToggle\}[\s\S]*?aria-expanded=\{expanded\}/);
	assert.match(source, /expanded \? <ChevronDown[\s\S]*?: <ChevronRight/);
	assert.match(source, /row\.groupRows\?\.at\(-1\) \?\? row/, "the collapsed bundle header must always show the newest tool call");
	assert.match(source, /const toolCallCount = row\.groupRows\?\.length \?\? 0/);
	assert.match(source, /data-pibo-tool-call-group-count="true"[\s\S]*?text-\[#22c55e\][\s\S]*?>\{toolCallCount\}<\/span>[\s\S]*?<TerminalRowContent/, "the live count must use Tool Call green and render before the current tool icon");
	assert.match(source, /data-pibo-tool-call-group-children="true"/);
	assert.match(source, /data-pibo-tool-call-group-child="true"[\s\S]*?disclosureMode="single"/);
	assert.match(source, /const singleClickDisclosure = disclosureMode === "single" \|\| row\.isToolCall/);
	assert.match(source, /onClick=\{row\.expandable && singleClickDisclosure \? handleRowToggle : undefined\}/);
	assert.match(traceSource, /onClick=\{toolDisplaySpan && !compactToolDisplay \? handleCardClick : undefined\}/, "Full trace tool details should also use one click");
	assert.match(source, /ml-12 mt-2 border-l border-\[#2a2a2a\] pl-2/, "expanded Slim rows should remain aligned beneath the counted header");
});
