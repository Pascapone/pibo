import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
	getActivePiboCompactionPromptPath,
	parsePiboCompactionPrompt,
	readPiboCompactionPrompt,
	savePiboCustomCompactionPrompt,
	setPiboCompactionPromptMode,
} from "../dist/core/compaction-prompt.js";

test("compaction prompt switches between library and custom prompt without losing custom content", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-compaction-prompt-"));
	try {
		assert.equal(basename(getActivePiboCompactionPromptPath(cwd)), "pibo-compaction-prompt.md");

		const library = await readPiboCompactionPrompt(cwd);
		const customMarkdown = library.library.markdown.replace("Use this EXACT format:", "Use this EXACT custom format:");
		const saved = await savePiboCustomCompactionPrompt(customMarkdown, cwd);
		assert.equal(saved.mode, "custom");
		assert.equal(saved.effectiveMode, "custom");
		assert.match(saved.custom.markdown, /Use this EXACT custom format:/);
		assert.equal(existsSync(saved.custom.path), true);
		assert.equal(getActivePiboCompactionPromptPath(cwd), saved.custom.path);

		const libraryMode = setPiboCompactionPromptMode("library", cwd);
		assert.equal(libraryMode.effectiveMode, "library");
		assert.match(libraryMode.custom.markdown, /Use this EXACT custom format:/);
		assert.equal(basename(getActivePiboCompactionPromptPath(cwd)), "pibo-compaction-prompt.md");

		const customMode = setPiboCompactionPromptMode("custom", cwd);
		assert.equal(customMode.effectiveMode, "custom");
		assert.match(customMode.custom.markdown, /Use this EXACT custom format:/);
		assert.equal(getActivePiboCompactionPromptPath(cwd), customMode.custom.path);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("compaction prompt custom mode without custom markdown falls back to library", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-compaction-prompt-missing-custom-"));
	try {
		mkdirSync(join(cwd, ".pibo"));
		writeFileSync(join(cwd, ".pibo/compaction-prompt.json"), `${JSON.stringify({ mode: "custom" }, null, 2)}\n`);

		const snapshot = await readPiboCompactionPrompt(cwd);
		assert.equal(snapshot.mode, "custom");
		assert.equal(snapshot.effectiveMode, "library");
		assert.equal(snapshot.custom.exists, false);
		assert.equal(snapshot.custom.markdown, "");
		assert.equal(snapshot.custom.updatedAt, undefined);
		assert.equal(basename(getActivePiboCompactionPromptPath(cwd)), "pibo-compaction-prompt.md");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("compaction prompt invalid custom save preserves previous valid custom prompt", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-compaction-prompt-preserve-custom-"));
	try {
		const library = await readPiboCompactionPrompt(cwd);
		const validMarkdown = library.library.markdown.replace("Use this EXACT format:", "Use this EXACT preserved format:");
		const saved = await savePiboCustomCompactionPrompt(validMarkdown, cwd);
		const previousUpdatedAt = saved.custom.updatedAt;
		const previousFile = readFileSync(saved.custom.path, "utf-8");

		await assert.rejects(
			() => savePiboCustomCompactionPrompt("<system-prompt>only one section</system-prompt>", cwd),
			/missing <summary-prompt> section/,
		);

		const after = await readPiboCompactionPrompt(cwd);
		assert.equal(after.mode, "custom");
		assert.equal(after.effectiveMode, "custom");
		assert.equal(after.custom.updatedAt, previousUpdatedAt);
		assert.equal(after.custom.markdown, previousFile);
		assert.match(after.custom.markdown, /Use this EXACT preserved format:/);
		assert.equal(getActivePiboCompactionPromptPath(cwd), saved.custom.path);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("compaction prompt custom mode creates custom file from library when missing", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-compaction-prompt-create-custom-"));
	try {
		const library = await readPiboCompactionPrompt(cwd);
		assert.equal(library.custom.exists, false);

		const customMode = setPiboCompactionPromptMode("custom", cwd);
		assert.equal(customMode.mode, "custom");
		assert.equal(customMode.effectiveMode, "custom");
		assert.equal(customMode.custom.exists, true);
		assert.equal(customMode.custom.markdown, library.library.markdown);
		assert.equal(readFileSync(customMode.custom.path, "utf-8"), library.library.markdown);
		assert.equal(getActivePiboCompactionPromptPath(cwd), customMode.custom.path);
		assert.ok(customMode.custom.updatedAt);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("compaction prompt parser exposes all prompt sections and rejects broken custom files", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-compaction-prompt-invalid-"));
	try {
		const snapshot = await readPiboCompactionPrompt(cwd);
		const spec = parsePiboCompactionPrompt(snapshot.library.markdown);
		assert.match(spec.systemPrompt, /context summarization assistant/);
		assert.match(spec.summaryPrompt, /## Goal/);
		assert.match(spec.updateSummaryPrompt, /<previous-summary>/);
		assert.match(spec.turnPrefixSummaryPrompt, /## Original Request/);

		await assert.rejects(
			() => savePiboCustomCompactionPrompt("<system-prompt>only one section</system-prompt>", cwd),
			/missing <summary-prompt> section/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
