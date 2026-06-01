import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function listSource(relativePath) {
	return readdir(new URL(`../${relativePath}`, import.meta.url));
}

function sectionBetween(source, startMarker, endMarker) {
	const startIndex = source.indexOf(startMarker);
	assert.notEqual(startIndex, -1, `missing section marker ${startMarker}`);
	const contentStart = startIndex + startMarker.length;
	const endIndex = source.indexOf(endMarker, contentStart);
	assert.notEqual(endIndex, -1, `missing section marker ${endMarker}`);
	return source.slice(contentStart, endIndex);
}

function splitTableRow(line) {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isDividerRow(cells) {
	return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(section) {
	const tableLines = section
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("|"));
	assert.ok(tableLines.length >= 3, "expected a markdown table with a header and rows");
	const headers = splitTableRow(tableLines[0]);
	const rows = [];
	for (const line of tableLines.slice(1)) {
		const cells = splitTableRow(line);
		if (isDividerRow(cells)) {
			continue;
		}
		assert.equal(cells.length, headers.length, `row has ${cells.length} cells but expected ${headers.length}: ${line}`);
		rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
	}
	return { headers, rows };
}

function normalizeLabel(label) {
	return label.toLowerCase().replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
	"the",
	"and",
	"are",
	"with",
	"only",
	"from",
	"into",
	"per",
	"one",
	"all",
	"has",
	"have",
	"can",
	"must",
	"may",
	"for",
	"v2",
	"ui",
]);

function meaningfulTokens(text) {
	return new Set(
		text
			.toLowerCase()
			.replace(/workflow\/xstate/g, "workflow xstate")
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.map((token) => (token.endsWith("s") ? token.slice(0, -1) : token))
			.filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
	);
}

function assertMeaningfulTitleOverlap(requirementTitle, tableTitle, requirementId) {
	const requirementTokens = meaningfulTokens(requirementTitle);
	const tableTokens = meaningfulTokens(tableTitle);
	const shared = [...requirementTokens].filter((token) => tableTokens.has(token));
	assert.ok(
		shared.length >= 2,
		`${requirementId} traceability title should describe the source requirement; shared tokens: ${shared.join(", ")}`,
	);
}

test("Workflow V2 requirement traceability maps every spec requirement to PRDs and completeness sections", async () => {
	const spec = await readSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/spec.md");
	const contract = await readSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/prds/09-implementation-completeness-contract.md");
	const prdFiles = await listSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/prds");

	const requirements = [...spec.matchAll(/^### Requirement: (.+)$/gm)].map((match, index) => ({
		id: `REQ-${String(index + 1).padStart(3, "0")}`,
		title: match[1].trim(),
	}));
	assert.equal(requirements.length, 41, "spec requirement count is part of the V2 traceability contract");

	const section = sectionBetween(contract, "### 4.13 Requirement Traceability", "### 4.14 Resolved Decisions Gate");
	assert.match(section, /Each requirement from `\.\.\/spec\.md` maps by REQ id to PRD coverage/);
	const { headers, rows } = parseMarkdownTable(section);
	assert.deepEqual(headers, ["Requirement", "Source requirement", "PRD coverage", "Completeness sections"]);
	assert.equal(rows.length, requirements.length, "every spec requirement needs one traceability row");

	for (const [index, requirement] of requirements.entries()) {
		const row = rows[index];
		assert.equal(row.Requirement, requirement.id);
		assertMeaningfulTitleOverlap(requirement.title, row["Source requirement"], requirement.id);

		const prdRefs = row["PRD coverage"].match(/\b0[1-9]\b/g) ?? [];
		assert.ok(prdRefs.length >= 1, `${requirement.id} must map to at least one PRD`);
		for (const prdRef of prdRefs) {
			assert.ok(prdFiles.some((file) => file.startsWith(`${prdRef}-`)), `${requirement.id} references existing PRD ${prdRef}`);
		}
		assert.match(row["Completeness sections"], /\b4\.(?:[1-9]|1[0-4])\b/, `${requirement.id} must map to a numbered completeness section`);
	}
});

test("Workflow V2 task traceability maps every tasks.md group to implementation areas and validation gates", async () => {
	const tasks = await readSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/tasks.md");
	const contract = await readSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/prds/09-implementation-completeness-contract.md");

	const taskGroups = [...tasks.matchAll(/^## (\d+\. .+)$/gm)].map((match) => match[1].trim());
	assert.equal(taskGroups.length, 16, "tasks.md task-group count is part of the traceability contract");

	const section = sectionBetween(contract, "### 4.12 Traceability to Task Groups", "### 4.13 Requirement Traceability");
	assert.match(section, /maps to an implementation area and a validation gate/);
	const { headers, rows } = parseMarkdownTable(section);
	assert.deepEqual(headers, ["Task group", "Implementation area", "Validation gate"]);
	assert.deepEqual(rows.map((row) => normalizeLabel(row["Task group"])), taskGroups.map(normalizeLabel));

	for (const row of rows) {
		assert.match(row["Implementation area"], /\b(Section|Sections|PRD|Project|Workflow|Workflows|Builder|Composition|Lifecycle|Validation|Security|docs)\b/i, `${row["Task group"]} needs a concrete implementation area`);
		assert.match(row["Validation gate"], /\b(PRD|JSON|test|tests|typecheck|browser|build|smoke|web-channel|package)\b/i, `${row["Task group"]} needs reviewable validation evidence`);
	}
});

test("Workflow V2 MUST checklist remains reviewable as pass/fail items", async () => {
	const contract = await readSource("docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/prds/09-implementation-completeness-contract.md");
	const checklist = sectionBetween(contract, "### 4.11 Implementation Checklist", "### 4.12 Traceability to Task Groups");
	assert.match(checklist, /Reviewer rule:[\s\S]*independent pass\/fail item/);

	const groupHeadings = [...checklist.matchAll(/^### (.+)$/gm)].map((match) => match[1].trim());
	assert.deepEqual(groupHeadings, [
		"Registry, Catalog, and Store",
		"Project Session Lifecycle",
		"Workflows UI and Builder",
		"Composition",
		"Lifecycle",
		"Projects Run View",
		"Validation, Security, and Tests",
	]);

	const mustItems = [...checklist.matchAll(/^- \[ \] MUST (.+)$/gm)].map((match) => match[1].trim());
	assert.ok(mustItems.length >= 30, "MUST checklist should expose the mandatory V2 review surface");
	for (const item of mustItems) {
		assert.match(item, /[A-Za-z]/, "MUST checklist item should have reviewable text");
		assert.doesNotMatch(item, /\b(TBD|TODO|unclear)\b/i, `MUST checklist item is not reviewable: ${item}`);
	}

	const strayMustLines = checklist
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /\bMUST\b/.test(line))
		.filter((line) => !line.includes("unchecked MUST item"))
		.filter((line) => !line.startsWith("- [ ] MUST "));
	assert.deepEqual(strayMustLines, [], "MUST checklist statements should be checkbox pass/fail items");
});
