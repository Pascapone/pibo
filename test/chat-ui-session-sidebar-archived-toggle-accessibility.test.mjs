import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");

function buttonContaining(marker) {
	const markerIndex = source.indexOf(marker);
	assert.notEqual(markerIndex, -1, `missing button marker: ${marker}`);
	const start = source.lastIndexOf("<button", markerIndex);
	const end = source.indexOf("</button>", markerIndex);
	assert.notEqual(start, -1, `missing button start for: ${marker}`);
	assert.notEqual(end, -1, `missing button end for: ${marker}`);
	return source.slice(start, end + "</button>".length);
}

test("Archived Rooms is a stable pressed-state toggle without changing its visual contract", () => {
	const button = buttonContaining('title={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}');

	assert.match(button, /type="button"/);
	assert.match(button, /onClick=\{onToggleArchivedRooms\}/);
	assert.match(button, /title=\{showArchivedRooms \? "Hide Archived Rooms" : "Show Archived Rooms"\}/);
	assert.match(button, /aria-label="Archived Rooms"/);
	assert.match(button, /aria-pressed=\{showArchivedRooms\}/);
	assert.match(button, /max-\[980px\]:h-8 max-\[980px\]:w-8/);
	assert.match(button, /showArchivedRooms \? "border-\[\#11a4d4\] text-\[\#11a4d4\]" : "border-slate-700 text-slate-400"/);
	assert.match(button, /showArchivedRooms \? <ArchiveRestore size=\{14\} \/> : <Archive size=\{14\} \/>/);
});

test("Session actions live in the selected room action menu without changing loading behavior", () => {
	assert.match(source, /const selectedSessionActions = selected \? sessionActions : undefined;/);
	const menus = source.match(/\{selectedSessionActions && \(\s*<>/g) ?? [];
	assert.equal(menus.length, 2, "expected session actions in the personal and standard room menus");
	assert.match(source, /onSelect=\{selectedSessionActions\.onCreateWorkflowSession\}/);
	assert.match(source, /<Workflow size=\{16\} \/> New Workflow Session/);
	assert.match(source, /onSelect=\{\(\) => void selectedSessionActions\.onToggleArchivedSessions\(\)\}/);
	assert.match(source, /disabled=\{selectedSessionActions\.archivedLoading\}/);
	assert.match(source, /\{selectedSessionActions\.showArchived \? "Hide Archived Sessions" : "Show Archived Sessions"\}/);
});
