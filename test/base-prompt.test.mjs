import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
	getActivePiboBasePromptPath,
	readPiboBasePrompt,
	savePiboCustomBasePrompt,
	setPiboBasePromptMode,
} from "../dist/core/base-prompt.js";

async function withTempCwd(fn) {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-base-prompt-"));
	try {
		return await fn(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("base prompt defaults to library prompt without local state", async () =>
	withTempCwd(async (cwd) => {
		const snapshot = await readPiboBasePrompt(cwd);

		assert.equal(snapshot.mode, "library");
		assert.equal(snapshot.effectiveMode, "library");
		assert.equal(snapshot.custom.exists, false);
		assert.equal(snapshot.custom.markdown, "");
		assert.equal(basename(getActivePiboBasePromptPath(cwd)), "pibo-system-prompt.md");
	}));

test("base prompt switches between library and custom prompt without losing custom content", async () =>
	withTempCwd(async (cwd) => {
		assert.equal(basename(getActivePiboBasePromptPath(cwd)), "pibo-system-prompt.md");

		const saved = await savePiboCustomBasePrompt("custom base prompt", cwd);
		assert.equal(saved.mode, "custom");
		assert.equal(saved.effectiveMode, "custom");
		assert.equal(saved.custom.markdown, "custom base prompt");
		assert.equal(existsSync(saved.custom.path), true);
		assert.equal(getActivePiboBasePromptPath(cwd), saved.custom.path);

		const library = setPiboBasePromptMode("library", cwd);
		assert.equal(library.effectiveMode, "library");
		assert.equal(library.custom.markdown, "custom base prompt");
		assert.equal(basename(getActivePiboBasePromptPath(cwd)), "pibo-system-prompt.md");

		const custom = setPiboBasePromptMode("custom", cwd);
		assert.equal(custom.effectiveMode, "custom");
		assert.equal(custom.custom.markdown, "custom base prompt");
		assert.equal(getActivePiboBasePromptPath(cwd), custom.custom.path);

		const snapshot = await readPiboBasePrompt(cwd);
		assert.equal(snapshot.custom.markdown, "custom base prompt");
	}));

test("base prompt custom mode creates a library copy when custom file is missing", async () =>
	withTempCwd(async (cwd) => {
		const custom = setPiboBasePromptMode("custom", cwd);

		assert.equal(custom.mode, "custom");
		assert.equal(custom.effectiveMode, "custom");
		assert.equal(custom.custom.exists, true);
		assert.equal(custom.custom.markdown, custom.library.markdown);
		assert.equal(readFileSync(custom.custom.path, "utf-8"), custom.library.markdown);
		assert.equal(getActivePiboBasePromptPath(cwd), custom.custom.path);
	}));

test("base prompt falls back to library when state file is corrupt", async () =>
	withTempCwd(async (cwd) => {
		mkdirSync(join(cwd, ".pibo"), { recursive: true });
		writeFileSync(join(cwd, ".pibo/base-prompt.json"), "{not json");

		const snapshot = await readPiboBasePrompt(cwd);

		assert.equal(snapshot.mode, "library");
		assert.equal(snapshot.effectiveMode, "library");
		assert.equal(basename(getActivePiboBasePromptPath(cwd)), "pibo-system-prompt.md");
	}));

test("base prompt falls back to library when state mode is unknown", async () =>
	withTempCwd(async (cwd) => {
		mkdirSync(join(cwd, ".pibo"), { recursive: true });
		writeFileSync(join(cwd, ".pibo/base-prompt.json"), JSON.stringify({ mode: "future" }));

		const snapshot = await readPiboBasePrompt(cwd);

		assert.equal(snapshot.mode, "library");
		assert.equal(snapshot.effectiveMode, "library");
		assert.equal(basename(getActivePiboBasePromptPath(cwd)), "pibo-system-prompt.md");
	}));

test("legacy SYSTEM.md remains the reported effective prompt until it is removed", () =>
	withTempCwd(async (cwd) => {
		mkdirSync(join(cwd, ".pibo"), { recursive: true });
		const legacyPath = join(cwd, ".pibo/SYSTEM.md");
		writeFileSync(legacyPath, "legacy prompt");

		const initial = await readPiboBasePrompt(cwd);
		assert.equal(initial.mode, "library");
		assert.equal(initial.effectiveMode, "legacy");
		assert.equal(initial.legacy.path, legacyPath);
		assert.equal(initial.legacy.markdown, "legacy prompt");
		assert.equal(initial.legacy.exists, true);
		assert.equal(getActivePiboBasePromptPath(cwd), undefined);

		const saved = await savePiboCustomBasePrompt("saved custom prompt", cwd);
		assert.equal(saved.mode, "custom");
		assert.equal(saved.effectiveMode, "legacy");
		assert.equal(saved.custom.markdown, "saved custom prompt");
		assert.equal(saved.legacy.markdown, "legacy prompt");
		assert.equal(getActivePiboBasePromptPath(cwd), undefined);

		const reloaded = await readPiboBasePrompt(cwd);
		assert.equal(reloaded.mode, "custom");
		assert.equal(reloaded.effectiveMode, "legacy");

		rmSync(legacyPath);
		const activated = await readPiboBasePrompt(cwd);
		assert.equal(activated.effectiveMode, "custom");
		assert.equal(getActivePiboBasePromptPath(cwd), activated.custom.path);
	}));
