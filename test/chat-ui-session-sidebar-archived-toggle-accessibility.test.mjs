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

test("Archived Sessions is a stable pressed-state toggle without changing loading or visual behavior", () => {
	const button = buttonContaining('title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}');

	assert.match(source, /const archivedSessionsToggleRef = useRef<HTMLButtonElement>\(null\)/);
	assert.match(source, /const restoreFocus = archivedSessionsToggleRef\.current === document\.activeElement/);
	assert.match(source, /requestAnimationFrame\(\(\) => \{\s*if \(restoreFocus && document\.activeElement === document\.body\) archivedSessionsToggleRef\.current\?\.focus\(\);\s*\}\)/);
	assert.match(button, /type="button"/);
	assert.match(button, /ref=\{archivedSessionsToggleRef\}/);
	assert.match(button, /onClick=\{\(\) => void handleToggleArchivedSessions\(\)\}/);
	assert.match(button, /disabled=\{loadingArchivedSessions\}/);
	assert.match(button, /title=\{showArchived \? "Hide Archived Sessions" : "Show Archived Sessions"\}/);
	assert.match(button, /aria-label="Archived Sessions"/);
	assert.match(button, /aria-pressed=\{showArchived\}/);
	assert.match(button, /max-\[980px\]:h-8 max-\[980px\]:w-8/);
	assert.match(button, /showArchived \? "border-\[\#11a4d4\] text-\[\#11a4d4\]" : "border-slate-700 text-slate-400"/);
	assert.match(button, /loadingArchivedSessions \? <Loader2 size=\{14\} className="animate-spin" \/> : showArchived \? <ArchiveRestore size=\{14\} \/> : <Archive size=\{14\} \/>/);
});
