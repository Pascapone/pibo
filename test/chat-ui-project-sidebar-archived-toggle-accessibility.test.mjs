import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/apps/chat-ui/src/projects/ProjectsSidebar.tsx"), "utf8");

function buttonContaining(marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing button marker: ${marker}`);
  const start = source.lastIndexOf("<button", markerIndex);
  const end = source.indexOf("</button>", markerIndex);
  assert.notEqual(start, -1, `missing button start for: ${marker}`);
  assert.notEqual(end, -1, `missing button end for: ${marker}`);
  return source.slice(start, end + "</button>".length);
}

test("Archived Projects exposes its persistent pressed state", () => {
  const button = buttonContaining('aria-label="Archived Projects"');
  assert.match(button, /onClick=\{onToggleArchivedProjects\}/);
  assert.match(button, /aria-label="Archived Projects"/);
  assert.match(button, /aria-pressed=\{showArchivedProjects\}/);
  assert.match(button, /showArchivedProjects \? "border-\[\#11a4d4\] text-\[\#11a4d4\]" : "border-slate-700 text-slate-400"/);
});

test("Archived Project Sessions exposes a stable name and persistent pressed state", () => {
  const button = buttonContaining('aria-label="Archived Project Sessions"');
  assert.match(button, /onClick=\{onToggleArchivedSessions\}/);
  assert.match(button, /title=\{\s*showArchivedSessions\s*\? "Hide Archived Project Sessions"\s*: "Show Archived Project Sessions"\s*\}/);
  assert.match(button, /aria-label="Archived Project Sessions"/);
  assert.match(button, /aria-pressed=\{showArchivedSessions\}/);
  assert.match(button, /showArchivedSessions \? "border-\[\#11a4d4\] text-\[\#11a4d4\]" : "border-slate-700 text-slate-400"/);
});
