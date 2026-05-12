import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiSourceFiles = [
	"src/apps/chat-ui/src/WorkflowsArea.tsx",
	"src/apps/chat-ui/src/App.tsx",
	"src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx",
];

const workflowBoundaryPhrases = [
	/No inline TypeScript, JavaScript, shell, eval, arbitrary executable code/i,
	/No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents/i,
	/No YAML\/JSON product import\/export or TypeScript export path/i,
	/No Zod schema authoring/i,
];

const projectBoundaryPhrases = [
	/workflow templates/i,
	/workflow slash commands/i,
	/workflow tools for agents/i,
	/inline TypeScript\/JavaScript\/shell\/eval code/i,
	/raw XState editing/i,
	/TypeScript export/i,
	/YAML\/JSON product import\/export/i,
	/Zod schema authoring/i,
];

const forbiddenInteractivePatterns = [
	{
		name: "inline executable code authoring",
		pattern: /\binline\s+(?:typescript|javascript)\b|\bjavascript\s+eval\b|\bshell\/?eval\b|\beval\s+code\b|\barbitrary\s+executable\b|\braw\s+handler\s+bod(?:y|ies)\b/i,
	},
	{
		name: "raw XState editing",
		pattern: /\braw\s+xstate\b|\bxstate\s+(?:source\s+)?(?:edit|editor|editing|import|export|json)\b/i,
	},
	{
		name: "Zod schema authoring",
		pattern: /\bzod\b/i,
	},
	{
		name: "workflow templates",
		pattern: /\bworkflow\s+templates?\b/i,
	},
	{
		name: "workflow slash commands",
		pattern: /\bworkflow\s+slash\s+commands?\b|\bslash\s+commands?\b/i,
	},
	{
		name: "workflow tools for agents",
		pattern: /\bworkflow\s+tools?\s+for\s+agents\b/i,
	},
	{
		name: "product import/export",
		pattern: /\b(?:yaml|json)\b[\s\/-]*(?:product\s*)?(?:import|export)\b|\b(?:import|export)\b[\s\/-]*(?:product\s*)?\b(?:yaml|json)\b|\btypescript\s+export\b|\bexport\s+typescript\b/i,
	},
];

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function normalizeFragment(value) {
	return value
		.replace(/<[^>]+>/g, " ")
		.replace(/\{[^{}]*\}/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function collectInteractiveFragments(source, filePath) {
	const fragments = [];
	const blockTags = ["button", "a", "option"];
	for (const tag of blockTags) {
		const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
		for (const match of source.matchAll(pattern)) {
			const raw = match[0];
			const labels = [...raw.matchAll(/(?:aria-label|title|placeholder)=\"([^\"]+)\"/g)].map((labelMatch) => labelMatch[1]);
			fragments.push({ filePath, kind: tag, text: normalizeFragment(`${labels.join(" ")} ${raw}`) });
		}
	}

	const interactiveTags = ["select", "textarea", "input"];
	for (const tag of interactiveTags) {
		const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
		for (const match of source.matchAll(pattern)) {
			const raw = match[0];
			const labels = [...raw.matchAll(/(?:aria-label|title|placeholder)=\"([^\"]+)\"/g)].map((labelMatch) => labelMatch[1]);
			fragments.push({ filePath, kind: tag, text: normalizeFragment(labels.join(" ") || raw) });
		}
	}
	return fragments.filter((fragment) => fragment.text.length > 0);
}

test("workflow V2 UI names every explicit deferral in scope-boundary copy", async () => {
	const workflowsSource = await readSource("src/apps/chat-ui/src/WorkflowsArea.tsx");
	const appSource = await readSource("src/apps/chat-ui/src/App.tsx");

	assert.match(workflowsSource, /aria-label=\"Workflow V2 explicit non-goals\"/);
	for (const phrase of workflowBoundaryPhrases) {
		assert.match(workflowsSource, phrase);
	}

	assert.match(appSource, /aria-label=\"Project workflow V2 explicit non-goals\"/);
	for (const phrase of projectBoundaryPhrases) {
		assert.match(appSource, phrase);
	}
});

test("workflow V2 UI controls do not expose deferred authoring actions", async () => {
	const fragments = [];
	for (const filePath of uiSourceFiles) {
		fragments.push(...collectInteractiveFragments(await readSource(filePath), filePath));
	}

	for (const fragment of fragments) {
		for (const forbidden of forbiddenInteractivePatterns) {
			assert.doesNotMatch(
				fragment.text,
				forbidden.pattern,
				`${fragment.filePath} ${fragment.kind} exposes deferred ${forbidden.name}: ${fragment.text}`,
			);
		}
	}
});
